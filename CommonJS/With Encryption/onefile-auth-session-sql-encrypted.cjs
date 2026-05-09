/**
 * Based on:
 * https://github.com/IsMeElyn/-useMultiFileAuthState-for-Baileys
 *
 * This file has been modified and adapted.
 * Original work is licensed under MIT License.
 */

const initSqlJs = require('sql.js');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Mutex } = require('async-mutex');
const { proto, initAuthCreds } = require('@whiskeysockets/baileys');
const { createRequire } = require('node:module');

const requireResolve = createRequire(__filename);

// WARNING: Move this secret to .env in production.
// If this value changes, the existing encrypted session data will no longer be readable.
const AUTH_SECRET = process.env.AUTH_SECRET || 'ganti_password_ini_sekarang';

const BufferJSON = {
  replacer: (_, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { type: 'Buffer', data: Array.from(value) };
    }
    return value;
  },
  reviver: (_, value) => {
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  },
};

const ENC_PREFIX = 'enc:';
const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = crypto.scryptSync(AUTH_SECRET, 'useSqlAuthState-salt', 32);

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    ENC_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function decryptText(payload) {
  if (typeof payload !== 'string') return null;

  // Backward compatibility: allow old plaintext rows
  if (!payload.startsWith(ENC_PREFIX)) return payload;

  const parts = payload.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return null;

  const [ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = crypto.createDecipheriv(
      ENC_ALGO,
      ENC_KEY,
      Buffer.from(ivB64, 'base64')
    );

    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function encryptJSON(value) {
  return encryptText(JSON.stringify(value, BufferJSON.replacer));
}

function decryptJSON(raw) {
  if (raw == null) return null;

  const text = decryptText(raw);
  if (!text) return null;

  try {
    return JSON.parse(text, BufferJSON.reviver);
  } catch {
    return null;
  }
}

let sqlPromise = null;

function getSqlJs() {
  if (!sqlPromise) {
    const wasmPath = requireResolve.resolve('sql.js/dist/sql-wasm.wasm');

    sqlPromise = initSqlJs({
      locateFile: () => wasmPath,
    });
  }
  return sqlPromise;
}

async function validateDbFile(SQL, filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const bytes = await fsp.readFile(filePath);
    const testDb = new SQL.Database(bytes);
    testDb.close?.();
    return bytes;
  } catch {
    return null;
  }
}

async function openBestDatabase(SQL, dbPath, bakPath, tmpPath) {
  const main = await validateDbFile(SQL, dbPath);
  if (main) {
    if (!fs.existsSync(bakPath)) {
      await fsp.copyFile(dbPath, bakPath).catch(() => {});
    }
    if (fs.existsSync(tmpPath)) {
      await fsp.unlink(tmpPath).catch(() => {});
    }
    return main;
  }

  const bak = await validateDbFile(SQL, bakPath);
  if (bak) {
    await fsp.copyFile(bakPath, dbPath).catch(() => {});
    return bak;
  }

  const tmp = await validateDbFile(SQL, tmpPath);
  if (tmp) {
    await fsp.copyFile(tmpPath, dbPath).catch(() => {});
    await fsp.copyFile(tmpPath, bakPath).catch(() => {});
    await fsp.unlink(tmpPath).catch(() => {});
    return tmp;
  }

  return null;
}

function ensureSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    )
  `);
}

function getRow(db, key) {
  const stmt = db.prepare('SELECT v FROM kv WHERE k = ?');
  try {
    stmt.bind([key]);
    if (!stmt.step()) return null;
    return stmt.getAsObject().v ?? null;
  } finally {
    stmt.free();
  }
}

function setRow(db, key, value) {
  db.run('REPLACE INTO kv (k, v) VALUES (?, ?)', [key, value]);
}

function deleteRow(db, key) {
  db.run('DELETE FROM kv WHERE k = ?', [key]);
}

async function useSqlAuthState(folder = './session') {
  await fsp.mkdir(folder, { recursive: true });

  const dbPath = path.join(folder, 'auth.db');
  const bakPath = path.join(folder, 'auth.db.bak');
  const tmpPath = path.join(folder, 'auth.db.tmp');

  const SQL = await getSqlJs();
  const initial = await openBestDatabase(SQL, dbPath, bakPath, tmpPath);
  const db = initial ? new SQL.Database(initial) : new SQL.Database();

  ensureSchema(db);

  const lock = new Mutex();

  const persist = async () => {
    const bytes = Buffer.from(db.export());

    try {
      await fsp.writeFile(tmpPath, bytes);

      if (fs.existsSync(dbPath)) {
        await fsp.unlink(dbPath).catch(() => {});
      }

      await fsp.rename(tmpPath, dbPath);
      await fsp.writeFile(bakPath, bytes);
    } catch {
      await fsp.unlink(tmpPath).catch(() => {});
    }
  };

  const readData = async (key) => {
    try {
      const raw = getRow(db, key);
      return decryptJSON(raw);
    } catch {
      return null;
    }
  };

  const writeData = async (key, value) => {
    await lock.runExclusive(async () => {
      setRow(db, key, encryptJSON(value));
      await persist();
    });
  };

  const removeData = async (key) => {
    await lock.runExclusive(async () => {
      deleteRow(db, key);
      await persist();
    });
  };

  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    setRow(db, 'creds', encryptJSON(creds));
    await persist();
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        for (const id of ids) {
          let value = await readData(`key:${type}:${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        }
        return data;
      },
      set: async (data) => {
        await lock.runExclusive(async () => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `key:${category}:${id}`;

              if (value == null) {
                deleteRow(db, key);
              } else {
                setRow(db, key, encryptJSON(value));
              }
            }
          }
          await persist();
        });
      },
    },
  };

  const saveCreds = async () => {
    await lock.runExclusive(async () => {
      setRow(db, 'creds', encryptJSON(state.creds));
      await persist();
    });
  };

  const close = async () => {
    await lock.runExclusive(async () => {
      await persist();
      db.close?.();
    });
  };

  return { state, saveCreds, close };
}

module.exports = { useSqlAuthState };

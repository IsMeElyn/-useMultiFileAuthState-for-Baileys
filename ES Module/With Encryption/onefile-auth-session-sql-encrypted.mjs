/**
 * Based on:
 * https://github.com/IsMeElyn/useMultiFileAuthState-for-Baileys
 *
 * This file has been modified and adapted.
 * Original work is licensed under MIT License.
 */

import initSqlJs from 'sql.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Mutex } from 'async-mutex';
import { proto, initAuthCreds } from '@whiskeysockets/baileys';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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

/**
 * WARNING:
 * This fallback secret is hardcoded and insecure.
 * Always set AUTH_SECRET via environment variables (.env) in production
 * to prevent credential leakage and unauthorized decryption.
 */
const AUTH_SECRET = process.env.AUTH_SECRET || 'change_this_password_now';

const ENC_ALGO = 'aes-256-gcm';
const KEY_SALT = 'baileys-auth-session-salt-v1';
const KEY = crypto.scryptSync(AUTH_SECRET, KEY_SALT, 32);

let sqlPromise = null;

function getSqlJs() {
  if (!sqlPromise) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

    sqlPromise = initSqlJs({
      locateFile: () => wasmPath,
    });
  }
  return sqlPromise;
}

function encryptText(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptText(payload) {
  const parsed = JSON.parse(payload);

  if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const data = Buffer.from(parsed.data, 'base64');

  const decipher = crypto.createDecipheriv(ENC_ALGO, KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

function serializeValue(value) {
  const json = JSON.stringify(value, BufferJSON.replacer);
  return encryptText(json);
}

function deserializeValue(raw) {
  if (raw == null) return null;

  try {
    const decrypted = decryptText(raw);
    return JSON.parse(decrypted, BufferJSON.reviver);
  } catch {
    // Legacy fallback: allow old plaintext JSON to keep working.
    try {
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      return null;
    }
  }
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

export async function useSqlAuthState(folder = './session') {
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
      return deserializeValue(raw);
    } catch {
      return null;
    }
  };

  const writeData = async (key, value) => {
    await lock.runExclusive(async () => {
      setRow(db, key, serializeValue(value));
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
    setRow(db, 'creds', serializeValue(creds));
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
                setRow(db, key, serializeValue(value));
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
      setRow(db, 'creds', serializeValue(state.creds));
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

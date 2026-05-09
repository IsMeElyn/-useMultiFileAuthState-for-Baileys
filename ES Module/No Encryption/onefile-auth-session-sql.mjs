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

let sqlPromise = null;

function getSqlJs() {
  if (!sqlPromise) {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

    sqlPromise = initSqlJs({
      locateFile: () => wasmPath
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
      return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
    } catch {
      return null;
    }
  };

  const writeData = async (key, value) => {
    await lock.runExclusive(async () => {
      setRow(db, key, JSON.stringify(value, BufferJSON.replacer));
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
    setRow(db, 'creds', JSON.stringify(creds, BufferJSON.replacer));
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
              if (value == null) deleteRow(db, key);
              else setRow(db, key, JSON.stringify(value, BufferJSON.replacer));
            }
          }
          await persist();
        });
      },
    },
  };

  const saveCreds = async () => {
    await lock.runExclusive(async () => {
      setRow(db, 'creds', JSON.stringify(state.creds, BufferJSON.replacer));
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

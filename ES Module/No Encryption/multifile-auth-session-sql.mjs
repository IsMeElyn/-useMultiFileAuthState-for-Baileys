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
      locateFile: () => wasmPath,
    });
  }
  return sqlPromise;
}

function logicalKeyToStem(logicalKey) {
  if (logicalKey === 'creds') return 'creds';
  return encodeURIComponent(logicalKey);
}

function getEntryPaths(folder, logicalKey) {
  const stem = logicalKeyToStem(logicalKey);
  return {
    dbPath: path.join(folder, `${stem}.db`),
    bakPath: path.join(folder, `${stem}.db.bak`),
    tmpPath: path.join(folder, `${stem}.db.tmp`),
  };
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

async function persistDatabase(db, dbPath, bakPath, tmpPath) {
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
}

async function readEntry(SQL, folder, logicalKey) {
  const { dbPath, bakPath, tmpPath } = getEntryPaths(folder, logicalKey);
  const bytes = await openBestDatabase(SQL, dbPath, bakPath, tmpPath);
  if (!bytes) return null;

  const db = new SQL.Database(bytes);
  try {
    ensureSchema(db);
    const raw = getRow(db, 'value');
    return raw ? JSON.parse(raw, BufferJSON.reviver) : null;
  } catch {
    return null;
  } finally {
    db.close?.();
  }
}

async function writeEntry(SQL, folder, logicalKey, value, lock) {
  const { dbPath, bakPath, tmpPath } = getEntryPaths(folder, logicalKey);

  await lock.runExclusive(async () => {
    const bytes = await openBestDatabase(SQL, dbPath, bakPath, tmpPath);
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();

    try {
      ensureSchema(db);
      setRow(db, 'value', JSON.stringify(value, BufferJSON.replacer));
      await persistDatabase(db, dbPath, bakPath, tmpPath);
    } finally {
      db.close?.();
    }
  });
}

async function removeEntry(folder, logicalKey) {
  const { dbPath, bakPath, tmpPath } = getEntryPaths(folder, logicalKey);

  await Promise.all([
    fsp.unlink(dbPath).catch(() => {}),
    fsp.unlink(bakPath).catch(() => {}),
    fsp.unlink(tmpPath).catch(() => {}),
  ]);
}

export async function useSqlAuthState(folder = './session') {
  await fsp.mkdir(folder, { recursive: true });

  const SQL = await getSqlJs();
  const lock = new Mutex();

  let creds = await readEntry(SQL, folder, 'creds');

  if (!creds) {
    creds = initAuthCreds();
    await writeEntry(SQL, folder, 'creds', creds, lock);
  }

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};

        for (const id of ids) {
          let value = await readEntry(SQL, folder, `key:${type}:${id}`);

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
              const logicalKey = `key:${category}:${id}`;

              if (value == null) {
                await removeEntry(folder, logicalKey);
              } else {
                await writeEntry(SQL, folder, logicalKey, value, lock);
              }
            }
          }
        });
      },
    },
  };

  const saveCreds = async () => {
    await writeEntry(SQL, folder, 'creds', state.creds, lock);
  };

  const close = async () => {
    await lock.runExclusive(async () => {
      await saveCreds().catch(() => {});
    });
  };

  return { state, saveCreds, close };
}

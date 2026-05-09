/**
 * Based on:
 * https://github.com/IsMeElyn/-useMultiFileAuthState-for-Baileys
 *
 * This file has been modified and adapted.
 * Original work is licensed under MIT License.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Mutex } = require('async-mutex');
const { proto, initAuthCreds } = require('@whiskeysockets/baileys');

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

const AUTH_SECRET = process.env.AUTH_SECRET || 'change_this_password_now'; // WARNING: Fallback secret is hardcoded and insecure. Always set AUTH_SECRET via environment variables (.env) in production to prevent credential leakage and unauthorized decryption.

function safeName(input) {
  return encodeURIComponent(String(input)).replace(/%/g, '_');
}

function entryPaths(folder, key) {
  const base = path.join(folder, `${safeName(key)}.db`);
  return {
    db: base,
    bak: `${base}.bak`,
    tmp: `${base}.tmp`,
  };
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function encryptValue(value) {
  const plain = JSON.stringify(value, BufferJSON.replacer);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(AUTH_SECRET, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    s: salt.toString('base64'),
    i: iv.toString('base64'),
    t: tag.toString('base64'),
    d: encrypted.toString('base64'),
  });
}

function decryptValue(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.v !== 1) return null;

  const salt = Buffer.from(parsed.s, 'base64');
  const iv = Buffer.from(parsed.i, 'base64');
  const tag = Buffer.from(parsed.t, 'base64');
  const data = Buffer.from(parsed.d, 'base64');
  const key = deriveKey(AUTH_SECRET, salt);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain, BufferJSON.reviver);
}

async function readEncryptedFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = await fsp.readFile(filePath, 'utf8');
    return decryptValue(raw);
  } catch {
    return null;
  }
}

async function validateEntry(folder, key) {
  const { db, bak } = entryPaths(folder, key);

  const main = await readEncryptedFile(db);
  if (main !== null) {
    if (!fs.existsSync(bak)) {
      await fsp.copyFile(db, bak).catch(() => {});
    }
    return main;
  }

  const backup = await readEncryptedFile(bak);
  if (backup !== null) {
    await fsp.copyFile(bak, db).catch(() => {});
    return backup;
  }

  return null;
}

async function writeEncryptedAtomic(folder, key, value) {
  const { db, bak, tmp } = entryPaths(folder, key);
  const payload = encryptValue(value);

  await fsp.writeFile(tmp, payload, 'utf8');

  try {
    if (fs.existsSync(db)) {
      await fsp.unlink(db).catch(() => {});
    }
    await fsp.rename(tmp, db);
    await fsp.writeFile(bak, payload, 'utf8');
  } catch {
    await fsp.unlink(tmp).catch(() => {});
    throw new Error(`Gagal menyimpan data untuk key: ${key}`);
  }
}

async function removeEntry(folder, key) {
  const { db, bak, tmp } = entryPaths(folder, key);
  await fsp.unlink(db).catch(() => {});
  await fsp.unlink(bak).catch(() => {});
  await fsp.unlink(tmp).catch(() => {});
}

async function useSqlAuthState(folder = './session') {
  await fsp.mkdir(folder, { recursive: true });

  const lock = new Mutex();

  const readData = async (key) => {
    try {
      return await validateEntry(folder, key);
    } catch {
      return null;
    }
  };

  const writeData = async (key, value) => {
    await lock.runExclusive(async () => {
      await writeEncryptedAtomic(folder, key, value);
    });
  };

  const deleteData = async (key) => {
    await lock.runExclusive(async () => {
      await removeEntry(folder, key);
    });
  };

  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
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
                await removeEntry(folder, key);
              } else {
                await writeEncryptedAtomic(folder, key, value);
              }
            }
          }
        });
      },
    },
  };

  const saveCreds = async () => {
    await lock.runExclusive(async () => {
      await writeEncryptedAtomic(folder, 'creds', state.creds);
    });
  };

  const close = async () => {
    await lock.runExclusive(async () => {
      await writeEncryptedAtomic(folder, 'creds', state.creds).catch(() => {});
    });
  };

  return { state, saveCreds, close };
}

module.exports = { useSqlAuthState };

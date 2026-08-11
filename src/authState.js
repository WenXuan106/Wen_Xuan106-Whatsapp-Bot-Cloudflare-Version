// Replacement for Baileys' useMultiFileAuthState(), which writes one JSON
// file per key to a folder on disk. Workers has no filesystem, so this
// stores the same data as rows in the Durable Object's SQLite storage
// instead. Mirrors the on-disk version's shape closely on purpose, so the
// rest of lib/whatsapp.js barely has to change.
//
// KNOWN RISK: this uses Baileys' own BufferJSON.replacer/reviver, same as
// the file-based version, to correctly round-trip Buffers/Uint8Arrays
// through JSON. That part should be safe. What's NOT yet verified is
// whether DO storage read/write volume is acceptable — Baileys can touch
// a lot of signal-protocol keys per message in busy chats, and each one
// is a separate storage.put() below (batched per call, but still). Watch
// your DO storage operation count if you use this in a group.

const { initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");

const CREDS_KEY = "auth:creds";
const KEY_PREFIX = "auth:key:";

async function useDurableObjectAuthState(storage) {
  async function readData(key) {
    const raw = await storage.get(key);
    if (!raw) return null;
    return JSON.parse(raw, BufferJSON.reviver);
  }

  async function writeData(key, data) {
    await storage.put(key, JSON.stringify(data, BufferJSON.replacer));
  }

  async function removeData(key) {
    await storage.delete(key);
  }

  const creds = (await readData(CREDS_KEY)) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${KEY_PREFIX}${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                // Baileys expects this specific proto wrapper on the way out,
                // same as the file-based implementation does.
                const { proto } = require("@whiskeysockets/baileys");
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value) data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${KEY_PREFIX}${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(CREDS_KEY, creds),
    // Used by resetAuth() equivalent — wipes everything under this DO.
    clearAll: () => storage.deleteAll(),
  };
}

module.exports = { useDurableObjectAuthState };

// Cloudflare Workers' crypto implementation hard-caps PBKDF2 at 100,000
// iterations (a platform-wide anti-abuse limit — see
// https://github.com/cloudflare/workerd/issues/1346). Baileys' phone-number
// pairing flow (Utils/crypto.js's derivePairingCodeKey) needs 131,072
// iterations, which WhatsApp's own protocol requires — not something
// Baileys chose. This produces exactly the "Pbkdf2 failed: iteration
// counts above 100000 are not supported" error.
//
// The cap applies specifically to node:crypto's accelerated pbkdf2/
// pbkdf2Sync primitive. It does NOT apply to the plain HMAC operation
// PBKDF2 is built from (crypto.createHmac), so this reimplements PBKDF2
// as a manual loop of individual HMAC calls to route around the capped
// fast-path entirely.
//
// MUST be required before "@whiskeysockets/baileys" anywhere in the
// codebase, so Baileys picks up the patched crypto.pbkdf2Sync rather
// than the original. See src/worker.js and src/session.js — this is
// required as the very first line in both.
//
// UNVERIFIED PERFORMANCE: 131,072 HMAC calls in a JS loop take real CPU
// time per pairing attempt (each call is itself native/fast, but there
// are a lot of them). This has not been measured against Workers' CPU
// time limits — if pairing now fails with a CPU-limit-exceeded error
// instead of the PBKDF2 error, that's the next thing to investigate
// (may need Workers' paid plan for a higher CPU budget, configurable in
// wrangler.toml under `limits.cpu_ms`).

const crypto = require("crypto");

function pbkdf2SyncManual(password, salt, iterations, keylen, digest) {
  const passwordBuf = Buffer.isBuffer(password) ? password : Buffer.from(password);
  const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt);
  const hLen = crypto.createHmac(digest, passwordBuf).digest().length;
  const blockCount = Math.ceil(keylen / hLen);
  const derivedKey = Buffer.alloc(blockCount * hLen);

  for (let i = 1; i <= blockCount; i++) {
    const blockIndex = Buffer.alloc(4);
    blockIndex.writeUInt32BE(i, 0);

    let u = crypto.createHmac(digest, passwordBuf).update(Buffer.concat([saltBuf, blockIndex])).digest();
    const t = Buffer.from(u);

    for (let j = 1; j < iterations; j++) {
      u = crypto.createHmac(digest, passwordBuf).update(u).digest();
      for (let k = 0; k < t.length; k++) t[k] ^= u[k];
    }

    t.copy(derivedKey, (i - 1) * hLen);
  }

  return derivedKey.subarray(0, keylen);
}

const ITERATION_CAP = 100000;

const originalPbkdf2Sync = crypto.pbkdf2Sync.bind(crypto);
crypto.pbkdf2Sync = function patchedPbkdf2Sync(password, salt, iterations, keylen, digest) {
  if (iterations > ITERATION_CAP) {
    return pbkdf2SyncManual(password, salt, iterations, keylen, digest);
  }
  return originalPbkdf2Sync(password, salt, iterations, keylen, digest);
};

const originalPbkdf2 = crypto.pbkdf2.bind(crypto);
crypto.pbkdf2 = function patchedPbkdf2(password, salt, iterations, keylen, digest, callback) {
  if (iterations > ITERATION_CAP) {
    queueMicrotask(() => {
      try {
        callback(null, pbkdf2SyncManual(password, salt, iterations, keylen, digest));
      } catch (err) {
        callback(err);
      }
    });
    return;
  }
  return originalPbkdf2(password, salt, iterations, keylen, digest, callback);
};

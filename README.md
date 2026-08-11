# wa-link — Cloudflare Workers port

This is a port of the Baileys pairing-code bot to Cloudflare Workers +
Durable Objects. **It has not been deployed or run against the real
Cloudflare runtime** (my environment has no network access and can't spin
up a live Worker) — treat this as a strong starting point, not a finished
product. Below is everything that's known to need attention, in the order
you'll hit it.

## 1. Install and try it locally first

```
npm install
npx wrangler dev
```

`wrangler dev` runs a local emulation of the Workers runtime — it will
surface most "this Node API doesn't exist here" errors without you having
to deploy first. Get this working before you `wrangler deploy`.

## 2. Fix these three files — they still use a real filesystem

Copying `commands/` and `lib/` over verbatim was NOT safe for everything.
These three still assume a disk exists, which Workers doesn't have:

- **`lib/civilguard.js`** — reads/writes `data/civilguard.json` via
  `fs.readFileSync`/`writeFileSync` to persist its moderation state.
  Replace this with Durable Object storage, same pattern as
  `src/authState.js`: `await this.ctx.storage.get("civilguard")` /
  `.put("civilguard", data)`. You'll need to pass the DO's `storage`
  handle into `handleCivilguardDetection(...)` from `src/session.js`
  (it currently doesn't receive one).

- **`commands/anime.js`** — writes an image to a temp file, shells out to
  an external command via `child_process.exec` to convert it to a sticker,
  then reads the result back off disk. Workers has no `child_process` and
  no filesystem at all. This command cannot run as-is; either drop it
  entirely or replace the conversion step with a pure-JS or WASM webp
  encoder that works on an in-memory buffer.

- **`commands/attp.js`** — same shape, via `lib/sticker.js` /
  `node-webpmux` and `fs/promises`. `node-webpmux` almost certainly won't
  load in a V8 isolate (it's not pure JS). Same options as above: drop it,
  or find/port a Workers-compatible webp/EXIF sticker library.

If you don't care about the `!attp` and animated-sticker features, the
fastest path is deleting both files and removing their lines from
`src/commandsIndex.js`.

## 3. Things that are wired up but genuinely unverified

- **Baileys' crypto internals.** `nodejs_compat` (already on in
  `wrangler.toml`) polyfills a lot of Node's `crypto`/`buffer`/`events`
  surface, but not guaranteed to be 100%. If `wrangler dev` throws errors
  from inside `@whiskeysockets/baileys` or a `libsignal` package, this is
  why. There's no shortcut here except reading the actual stack trace and
  patching or polyfilling whatever's missing.
- **Keeping the WhatsApp WebSocket open for days, not minutes.** The
  Durable Object should stay alive while it holds an open connection, but
  this pattern (a DO opening an *outbound* WebSocket to a third-party
  server, not accepting an inbound one) is far less common than
  Cloudflare's documented Hibernatable WebSockets use case. Watch your
  Cloudflare dashboard for the DO restarting/reconnecting more than
  expected — if it does, the reconnect-with-backoff logic in
  `src/session.js` should recover automatically, but you'll want to know
  it's happening.
- **`pino` was replaced** with a plain console-based shim
  (`src/logger.js`) rather than risking the real package failing to
  bundle. If you'd rather have real structured logs, try swapping the
  real `pino` back in and see if `wrangler dev` still runs.

## 4. What already works unchanged

- Everything in `public/` (the pairing website) — it already calls
  `/api/pair`, `/api/pair-qr`, `/api/status`, `/api/stream`, which is
  exactly what `src/worker.js` routes to the Durable Object.
- Most command files (`ping`, `dice`, `8ball`, `weather`, `gpt`, etc.) —
  they only touch `sock.sendMessage`/`msg`/`jid`, no fs, so they should
  run as-is. "Should" — you still want to smoke-test each one once you're
  connected.

## 5. Env vars / secrets

Set these with `wrangler secret put <NAME>` instead of a `.env` file
(Workers doesn't read `.env`):

```
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENWEATHER_API_KEY
```

`config.js` already reads from `process.env`, which Workers exposes
secrets as, so no code change needed there.

## 6. Deploy

```
npx wrangler deploy
```

Then open your `*.workers.dev` URL — you should land on the same
terminal-styled pairing page from your screenshot, this time actually
backed by a Durable Object instead of a Node server Cloudflare can't run.

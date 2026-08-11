// Durable Object = one persistent WhatsApp session. Ported from the
// original lib/whatsapp.js + index.js. A DO instance stays resident in
// memory as long as it has active work (like an open outbound WebSocket),
// which is the mechanism that replaces Express's long-running process.
//
// KNOWN RISKS, not yet verified — test these first with `wrangler dev`:
//  1. Baileys pulls in a signal-protocol implementation that expects
//     Node's `crypto` module surface. `nodejs_compat` covers a lot of it,
//     but if you see errors from deep inside @whiskeysockets/baileys or
//     libsignal, that's almost certainly this.
//  2. Long-idle outbound WebSockets: nothing here has been load-tested
//     for staying open for days. Cloudflare's Durable Objects docs
//     describe Hibernatable WebSockets for *inbound* connections a DO
//     accepts; this is an *outbound* connection Baileys itself opens to
//     WhatsApp's servers, which is a less-trodden path. Watch your
//     Cloudflare dashboard for unexpected DO evictions/restarts.
//  3. qrcode's canvas-based PNG rendering may not work — it's used here
//     in toDataURL mode only (no native canvas), which is more likely
//     to survive, but verify.

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");

const { useDurableObjectAuthState } = require("./authState");
const { createLogger } = require("./logger");
const { loadCommands } = require("./commandsIndex");
const { handleCivilguardDetection } = require("../lib/civilguard");
const { handleHangmanGuess } = require("../lib/hangman");
const { handleTicTacToeMove } = require("../lib/tictactoe");
const { handleScrambleGuess } = require("../lib/scramble");
const { handleMathAnswer } = require("../lib/mathquiz");

const PREFIX = "!";

export class WhatsAppSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sock = null;
    this.pendingPhoneNumber = null;
    this.pairingRequestedForThisSocket = false;
    this.consecutiveFailures = 0;
    this.processedMessageIds = new Set();
    this.messageStore = new Map();
    this.groupMetadataCache = new Map();
    this.commands = loadCommands();
    this.state = { status: "idle", pairingCode: null, qr: null, lastError: null };
    this.sseControllers = new Set(); // active SSE streams to push updates to

    // Resume an existing registered session on cold start, same as
    // resumeSavedSession() did on process boot in index.js.
    this.ctx.blockConcurrencyWhile(async () => {
      const { state: authState } = await useDurableObjectAuthState(this.ctx.storage);
      if (authState.creds.registered) {
        this.startSocket().catch((err) => this.setState({ status: "disconnected", lastError: err.message }));
      }
    });
  }

  setState(patch) {
    Object.assign(this.state, patch);
    const payload = `data: ${JSON.stringify(this.state)}\n\n`;
    for (const controller of this.sseControllers) {
      try {
        controller.enqueue(payload);
      } catch (_) {
        this.sseControllers.delete(controller);
      }
    }
  }

  async getGroupMetadata(activeSock, jid, { force = false } = {}) {
    const cached = this.groupMetadataCache.get(jid);
    const TTL_MS = 5 * 60 * 1000;
    if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.data;
    const data = await activeSock.groupMetadata(jid);
    this.groupMetadataCache.set(jid, { data, fetchedAt: Date.now() });
    return data;
  }

  alreadyProcessed(id) {
    if (!id) return false;
    if (this.processedMessageIds.has(id)) return true;
    this.processedMessageIds.add(id);
    if (this.processedMessageIds.size > 1000) {
      this.processedMessageIds.delete(this.processedMessageIds.values().next().value);
    }
    return false;
  }

  rememberMessage(key, message) {
    if (!key?.id || !message) return;
    this.messageStore.set(key.id, message);
    if (this.messageStore.size > 200) {
      this.messageStore.delete(this.messageStore.keys().next().value);
    }
  }

  async requestPairingCodeWithRetry(activeSock, phoneNumber, attempts = 4) {
    const digits = phoneNumber.replace(/[^0-9]/g, "");
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
      await new Promise((r) => setTimeout(r, i === 1 ? 2000 : 2500));
      try {
        return await activeSock.requestPairingCode(digits);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async startSocket({ phoneNumber, forceReset = false } = {}) {
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        this.sock.end(new Error("Restarting socket"));
      } catch (_) {}
      this.sock = null;
    }

    const { state: authState, saveCreds, clearAll } = await useDurableObjectAuthState(this.ctx.storage);

    if (forceReset) {
      await clearAll();
      this.pendingPhoneNumber = null;
      this.pairingRequestedForThisSocket = false;
    }

    if (phoneNumber) {
      this.pendingPhoneNumber = phoneNumber;
      this.pairingRequestedForThisSocket = false;
    } else if (!forceReset) {
      this.pendingPhoneNumber = null;
    }

    let version;
    try {
      ({ version } = await fetchLatestWaWebVersion());
    } catch (err) {
      ({ version } = await fetchLatestBaileysVersion());
    }

    const newSock = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false,
      logger: createLogger("silent"),
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      cachedGroupMetadata: (jid) => Promise.resolve(this.groupMetadataCache.get(jid)?.data),
      getMessage: async (key) => this.messageStore.get(key.id),
    });
    this.sock = newSock;

    if (this.pendingPhoneNumber && !newSock.authState.creds.registered && !this.pairingRequestedForThisSocket) {
      this.pairingRequestedForThisSocket = true;
      this.requestPairingCodeWithRetry(newSock, this.pendingPhoneNumber)
        .then((code) => this.setState({ status: "awaiting_code", pairingCode: code, lastError: null }))
        .catch((err) => this.setState({ status: "disconnected", lastError: err.message }));
    }

    const originalSendMessage = newSock.sendMessage.bind(newSock);
    newSock.sendMessage = async (...args) => {
      const sent = await originalSendMessage(...args);
      if (sent?.key && sent?.message) this.rememberMessage(sent.key, sent.message);
      return sent;
    };

    newSock.ev.on("creds.update", saveCreds);

    newSock.ev.on("groups.update", async ([update]) => {
      if (!update?.id) return;
      try {
        await this.getGroupMetadata(newSock, update.id, { force: true });
      } catch (_) {}
    });
    newSock.ev.on("group-participants.update", async ({ id }) => {
      try {
        await this.getGroupMetadata(newSock, id, { force: true });
      } catch (_) {}
    });

    newSock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !this.pendingPhoneNumber) {
        QRCode.toDataURL(qr)
          .then((dataUrl) => this.setState({ status: "awaiting_qr", qr: dataUrl, lastError: null }))
          .catch((err) => this.setState({ status: "disconnected", lastError: err.message }));
      }

      if (connection === "open") {
        this.pendingPhoneNumber = null;
        this.consecutiveFailures = 0;
        this.setState({ status: "connected", pairingCode: null, qr: null, lastError: null });
      }

      if (connection === "close") {
        const boomError = new Boom(lastDisconnect?.error);
        const statusCode = boomError?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const isExpectedRestart = statusCode === DisconnectReason.restartRequired;

        if (loggedOut) {
          clearAll();
          this.setState({ status: "disconnected", pairingCode: null });
          return;
        }

        if (!isExpectedRestart) this.setState({ status: "disconnected" });

        if (isExpectedRestart) {
          this.consecutiveFailures = 0;
          this.startSocket().catch((err) => this.setState({ status: "disconnected", lastError: err.message }));
        } else {
          this.consecutiveFailures += 1;
          const delayMs = Math.min(30000, 1000 * 2 ** (this.consecutiveFailures - 1));
          setTimeout(() => {
            this.startSocket().catch((err) => this.setState({ status: "disconnected", lastError: err.message }));
          }, delayMs);
        }
      }
    });

    newSock.ev.on("messages.upsert", async ({ messages, type }) => {
      const msg = messages[0];
      if (type !== "notify") return;
      if (!msg?.message) return;
      if (this.alreadyProcessed(msg.key?.id)) return;

      this.rememberMessage(msg.key, msg.message);

      const jid = msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      if (jid.endsWith("@g.us") && !msg.key.fromMe) {
        try {
          const senderJid = msg.key.participant || msg.key.remoteJid;
          const acted = await handleCivilguardDetection({
            sock: newSock,
            jid,
            msg,
            text,
            senderJid,
            getGroupMetadata: (groupJid, opts) => this.getGroupMetadata(newSock, groupJid, opts),
          });
          if (acted) return;
        } catch (err) {
          console.error("civilguard detection error:", err);
        }

        try {
          const senderJid = msg.key.participant || msg.key.remoteJid;
          if (await handleHangmanGuess({ sock: newSock, jid, text })) return;
          if (await handleTicTacToeMove({ sock: newSock, jid, senderId: senderJid, text })) return;
          if (await handleScrambleGuess({ sock: newSock, jid, text })) return;
          if (await handleMathAnswer({ sock: newSock, jid, text })) return;
        } catch (err) {
          console.error("game move handling error:", err);
        }
      }

      if (!text.startsWith(PREFIX)) return;

      const [cmdName, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
      const command = this.commands.get(cmdName.toLowerCase());
      if (!command) return;

      try {
        await command.execute({
          sock: newSock,
          msg,
          jid,
          args,
          commands: this.commands,
          getGroupMetadata: (groupJid, opts) => this.getGroupMetadata(newSock, groupJid, opts),
        });
      } catch (err) {
        console.error(`Error running command "${cmdName}":`, err);
        await newSock.sendMessage(jid, { text: "⚠️ Something went wrong running that command." });
      }
    });

    return newSock;
  }

  // Routed to from worker.js's fetch handler.
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/pair" && request.method === "POST") {
      const { phoneNumber } = await request.json();
      if (!phoneNumber || !/^\d{7,15}$/.test(phoneNumber.replace(/[^0-9]/g, ""))) {
        return Response.json({ error: "Enter your number with country code, digits only." }, { status: 400 });
      }
      try {
        await this.startSocket({ phoneNumber, forceReset: true });
        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/pair-qr" && request.method === "POST") {
      try {
        await this.startSocket({ forceReset: true });
        return Response.json({ ok: true });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    if (url.pathname === "/api/status") {
      return Response.json(this.state);
    }

    if (url.pathname === "/api/stream") {
      let thisController;
      let heartbeat;
      const stream = new ReadableStream({
        start: (controller) => {
          thisController = controller;
          this.sseControllers.add(controller);
          controller.enqueue(`data: ${JSON.stringify(this.state)}\n\n`);
          // Same reasoning as the original: keep the connection from going
          // quiet long enough for a proxy in front of the Worker to kill it.
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(`: heartbeat\n\n`);
            } catch (_) {
              clearInterval(heartbeat);
            }
          }, 15000);
        },
        cancel: () => {
          clearInterval(heartbeat);
          this.sseControllers.delete(thisController);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

// Replaces the 'ws' npm package (aliased in wrangler.toml's [alias] table)
// for the whole bundle. Baileys' Socket/Client/websocket.ts wraps 'ws' to
// open its outbound connection to WhatsApp's servers — 'ws' needs raw
// Node TCP/TLS sockets (net/tls) that Workers does not provide, which is
// why pairing and QR both hang forever with no error: the real 'ws'
// package can't actually open a connection here at all.
//
// Workers DOES support opening outbound WebSocket connections directly
// via the native `WebSocket` constructor for wss:// URLs. This file wraps
// that native WebSocket in a class exposing the same public surface 'ws'
// has (Node EventEmitter-style .on()/.once()/.send()/.close(), plus a
// .readyState and OPEN/CLOSED constants) so Baileys' code doesn't need to
// change at all — it just gets a different WebSocket implementation
// underneath.
//
// UNVERIFIED — genuinely untested against the real runtime:
//  1. Whether Baileys calls anything on the ws instance beyond what's
//     implemented below (check any error like "X is not a function" and
//     add the missing method here).
//  2. .ping()/.pong() are no-ops here — native WebSocket has no raw
//     protocol-level ping/pong frame API. If Baileys relies on real ping
//     frames (rather than its own app-level keepalive queries, which is
//     the more likely case), connections may drop after long idle
//     periods without this.
//  3. Binary frame handling: native WebSocket delivers binary messages
//     as ArrayBuffer by default; this converts them to Buffer since
//     that's what 'ws' (and therefore Baileys) expects.

const { EventEmitter } = require("events");

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

class WorkersWebSocketShim extends EventEmitter {
  constructor(address, protocols, options) {
    super();
    this.readyState = CONNECTING;
    this._socket = new WebSocket(address, protocols);
    this._socket.binaryType = "arraybuffer";

    this._socket.addEventListener("open", () => {
      this.readyState = OPEN;
      this.emit("open");
    });

    this._socket.addEventListener("message", (event) => {
      const data =
        typeof event.data === "string"
          ? event.data
          : Buffer.from(event.data instanceof ArrayBuffer ? event.data : event.data.buffer);
      this.emit("message", data, typeof event.data !== "string");
    });

    this._socket.addEventListener("close", (event) => {
      this.readyState = CLOSED;
      this.emit("close", event.code, event.reason || "");
    });

    this._socket.addEventListener("error", (event) => {
      this.emit("error", event.error || new Error("WebSocket error"));
    });
  }

  send(data, optionsOrCallback, callback) {
    const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
    try {
      this._socket.send(data);
      if (cb) cb();
    } catch (err) {
      if (cb) cb(err);
      else throw err;
    }
  }

  close(code, reason) {
    this.readyState = CLOSING;
    try {
      this._socket.close(code, reason);
    } catch (_) {
      // native WebSocket throws if called before OPEN in some
      // implementations — swallow, matches 'ws' being lenient here.
    }
  }

  terminate() {
    this.close();
  }

  // No raw protocol-level ping/pong on native WebSocket — see caveat above.
  ping(_data, _mask, callback) {
    if (typeof callback === "function") callback();
  }
  pong(_data, _mask, callback) {
    if (typeof callback === "function") callback();
  }
}

WorkersWebSocketShim.CONNECTING = CONNECTING;
WorkersWebSocketShim.OPEN = OPEN;
WorkersWebSocketShim.CLOSING = CLOSING;
WorkersWebSocketShim.CLOSED = CLOSED;

module.exports = WorkersWebSocketShim;
module.exports.WebSocket = WorkersWebSocketShim;
module.exports.default = WorkersWebSocketShim;

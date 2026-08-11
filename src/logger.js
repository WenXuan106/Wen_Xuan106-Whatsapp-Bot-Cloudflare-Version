// Baileys expects a pino-like logger: .trace/.debug/.info/.warn/.error and
// a .child() that returns another logger. The real `pino` package pulls in
// worker-thread/native transports that are unlikely to survive bundling
// for a V8 isolate, so this is a plain, dependency-free stand-in. Swap
// back to real pino only if you've confirmed it loads under `wrangler dev`.
function createLogger(level = "silent") {
  const noop = () => {};
  const active = level !== "silent";
  const logger = {
    level,
    trace: active ? console.debug.bind(console) : noop,
    debug: active ? console.debug.bind(console) : noop,
    info: active ? console.log.bind(console) : noop,
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    child: () => createLogger(level),
  };
  return logger;
}

module.exports = { createLogger };

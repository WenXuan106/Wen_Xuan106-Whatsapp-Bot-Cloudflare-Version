// Replacement for lib/commands.js's loadCommands(), which used
// fs.readdirSync("commands/") to auto-discover files at runtime. Workers
// bundles a fixed dependency graph at deploy time — there is no runtime
// directory listing and no dynamic require() — so every command has to be
// imported explicitly here. When you add a new file to commands/, add one
// line here too; it will NOT be picked up automatically like it was before.
//
// NOTE: copy the commands/ folder from the original repo into this
// project unchanged first. Most command files should just work — they
// only touch `sock`/`msg`/`jid` — EXCEPT any that use fs, path, or
// node-webpmux. Grep for those (see the README section of this response)
// and fix/remove them one at a time; don't assume the whole batch works.

// anime and attp are deliberately excluded: both depend on lib/sticker.js,
// which depends on node-webpmux — a native module that cannot be bundled
// or run in a Workers V8 isolate. Re-add them only once you've replaced
// lib/sticker.js with a pure-JS/WASM alternative.
const modules = {
  "8ball": require("../commands/8ball"),
  admin: require("../commands/admin"),
  answer: require("../commands/answer"),
  ban: require("../commands/ban"),
  civilguard: require("../commands/civilguard"),
  coinflip: require("../commands/coinflip"),
  delete: require("../commands/delete"),
  demote: require("../commands/demote"),
  dice: require("../commands/dice"),
  gemini: require("../commands/gemini"),
  gpt: require("../commands/gpt"),
  groupinfo: require("../commands/groupinfo"),
  hangman: require("../commands/hangman"),
  help: require("../commands/help"),
  kick: require("../commands/kick"),
  lyrics: require("../commands/lyrics"),
  mathquiz: require("../commands/mathquiz"),
  meme: require("../commands/meme"),
  milo: require("../commands/milo"),
  mute: require("../commands/mute"),
  ping: require("../commands/ping"),
  promote: require("../commands/promote"),
  rps: require("../commands/rps"),
  scramble: require("../commands/scramble"),
  ship: require("../commands/ship"),
  song: require("../commands/song"),
  status: require("../commands/status"),
  stop: require("../commands/stop"),
  tagall: require("../commands/tagall"),
  tictactoe: require("../commands/tictactoe"),
  topmembers: require("../commands/topmembers"),
  translate: require("../commands/translate"),
  trivia: require("../commands/trivia"),
  tts: require("../commands/tts"),
  unban: require("../commands/unban"),
  unmute: require("../commands/unmute"),
  vocaloid: require("../commands/vocaloid"),
  warn: require("../commands/warn"),
  warnings: require("../commands/warnings"),
  weather: require("../commands/weather"),
  welcome: require("../commands/welcome"),
};

function loadCommands() {
  const map = new Map();
  for (const cmd of Object.values(modules)) {
    if (!cmd?.name || typeof cmd.execute !== "function") continue;
    map.set(cmd.name.toLowerCase(), cmd);
  }
  return map;
}

module.exports = { loadCommands };

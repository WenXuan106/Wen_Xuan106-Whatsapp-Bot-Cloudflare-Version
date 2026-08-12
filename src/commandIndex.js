// Replacement for lib/commands.js's loadCommands(), which used
// fs.readdirSync("commands/") to auto-discover files at runtime. Workers
// bundles a fixed dependency graph at deploy time — there is no runtime
// directory listing and no dynamic require() — so every command has to be
// imported explicitly here. When you add a new file to commands/, add one
// line here too; it will NOT be picked up automatically like it was before.
//
// anime, attp, and song are deliberately excluded — see README for why.
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

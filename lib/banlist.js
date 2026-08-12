// Was fs-backed (data/banned.json). Workers has no filesystem, so this
// now lives in a module-level in-memory array instead.
//
// TRADE-OFF: this resets to empty whenever the Durable Object restarts or
// gets evicted (e.g. after a long idle period). It does NOT reset on
// every request — it survives as long as the DO instance stays warm,
// which for an active bot is most of the time. If you want bans to
// survive a full restart, migrate this to `this.ctx.storage` the same
// way src/authState.js does, and make these functions async (which then
// means updating every command file that calls them to `await` them).

let banned = [];

function isBanned(jid) {
  if (!jid) return false;
  return banned.includes(jid);
}

function addBanned(jid) {
  if (banned.includes(jid)) return false;
  banned.push(jid);
  return true;
}

function removeBanned(jid) {
  const index = banned.indexOf(jid);
  if (index === -1) return false;
  banned.splice(index, 1);
  return true;
}

module.exports = { isBanned, addBanned, removeBanned };

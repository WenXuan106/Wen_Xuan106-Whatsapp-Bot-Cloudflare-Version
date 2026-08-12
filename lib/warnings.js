// Was fs-backed (data/warnings.json). Same in-memory trade-off as
// lib/banlist.js — see the comment there.

const MAX_WARNINGS = 3;
const all = {};

function getWarnings(groupJid, jid) {
  return all[groupJid]?.[jid] || 0;
}

function addWarning(groupJid, jid) {
  if (!all[groupJid]) all[groupJid] = {};
  all[groupJid][jid] = (all[groupJid][jid] || 0) + 1;
  return all[groupJid][jid];
}

function clearWarnings(groupJid, jid) {
  if (all[groupJid]) delete all[groupJid][jid];
}

module.exports = { MAX_WARNINGS, getWarnings, addWarning, clearWarnings };

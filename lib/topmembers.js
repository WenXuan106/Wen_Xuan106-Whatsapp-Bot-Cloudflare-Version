// Was fs-backed (data/messageCounts.json). Same in-memory trade-off as
// lib/banlist.js — see the comment there.

const counts = {};

function incrementCount(groupJid, userJid) {
  if (!counts[groupJid]) counts[groupJid] = {};
  counts[groupJid][userJid] = (counts[groupJid][userJid] || 0) + 1;
}

function getTop(groupJid, limit = 5) {
  const groupCounts = counts[groupJid] || {};
  return Object.entries(groupCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

module.exports = { incrementCount, getTop };

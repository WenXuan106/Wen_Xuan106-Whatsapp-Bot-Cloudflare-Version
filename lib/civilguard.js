// Was fs-backed (data/civilguard.json). Same in-memory trade-off as
// lib/banlist.js — see the comment there.

const { getGroupAdminStatus } = require("./admin");

const DEFAULT_BADWORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "pussy",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "slut",
  "whore",
  "motherfucker",
];

const KICK_THRESHOLD = 3;
const data = {};

function getGroupConfig(store, jid) {
  if (!store[jid]) store[jid] = { enabled: false, words: [], warnings: {} };
  if (!Array.isArray(store[jid].words)) store[jid].words = [];
  if (!store[jid].warnings) store[jid].warnings = {};
  return store[jid];
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsBadword(text, groupConfig) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const words = [...DEFAULT_BADWORDS, ...groupConfig.words];
  return words.some((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(lower));
}

async function handleCivilguardDetection({ sock, jid, msg, text, senderJid, getGroupMetadata }) {
  if (!jid.endsWith("@g.us")) return false;
  if (!text) return false;

  const groupConfig = getGroupConfig(data, jid);
  if (!groupConfig.enabled) return false;
  if (!containsBadword(text, groupConfig)) return false;

  const { senderIsAdmin, botIsAdmin } = await getGroupAdminStatus(sock, jid, msg, getGroupMetadata);
  if (senderIsAdmin) return false;

  if (botIsAdmin) {
    try {
      await sock.sendMessage(jid, { delete: msg.key });
    } catch (_) {}
  }

  groupConfig.warnings[senderJid] = (groupConfig.warnings[senderJid] || 0) + 1;
  const count = groupConfig.warnings[senderJid];
  const mentionTag = `@${senderJid.split("@")[0]}`;

  if (count >= KICK_THRESHOLD && botIsAdmin) {
    groupConfig.warnings[senderJid] = 0;
    try {
      await sock.groupParticipantsUpdate(jid, [senderJid], "remove");
      await sock.sendMessage(jid, {
        text: `🚫 ${mentionTag} removed after repeated bad language.`,
        mentions: [senderJid],
      });
    } catch (_) {
      await sock.sendMessage(jid, {
        text: `⚠️ ${mentionTag} that was your ${count}${count === 1 ? "st" : count === 2 ? "nd" : "rd"} warning — I tried to remove you but couldn't.`,
        mentions: [senderJid],
      });
    }
  } else {
    await sock.sendMessage(jid, {
      text: `⚠️ ${mentionTag} watch your language. (${count}/${KICK_THRESHOLD} warnings)`,
      mentions: [senderJid],
    });
  }

  return true;
}

module.exports = {
  DEFAULT_BADWORDS,
  KICK_THRESHOLD,
  getGroupConfig,
  containsBadword,
  handleCivilguardDetection,
};

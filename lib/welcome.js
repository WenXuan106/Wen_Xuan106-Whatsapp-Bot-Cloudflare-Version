// Was fs-backed (data/welcome.json). Same in-memory trade-off as
// lib/banlist.js — see the comment there.

const data = {};

function getSettings(jid) {
  return data[jid] || { enabled: false, message: null };
}

function setEnabled(jid, enabled) {
  if (!data[jid]) data[jid] = { enabled: false, message: null };
  data[jid].enabled = enabled;
}

function setMessage(jid, message) {
  if (!data[jid]) data[jid] = { enabled: false, message: null };
  data[jid].message = message;
}

function buildMessage(settings, userJid, groupName) {
  const mention = `@${userJid.split("@")[0]}`;
  if (settings.message) {
    return settings.message.replace(/{user}/g, mention).replace(/{group}/g, groupName);
  }
  return `👋 Welcome ${mention} to *${groupName}*! Glad to have you here.`;
}

async function handleJoin({ sock, jid, participants }) {
  const settings = getSettings(jid);
  if (!settings.enabled) return;

  let groupName = jid;
  try {
    const metadata = await sock.groupMetadata(jid);
    groupName = metadata.subject || jid;
  } catch (_) {}

  for (const userJid of participants) {
    try {
      await sock.sendMessage(jid, {
        text: buildMessage(settings, userJid, groupName),
        mentions: [userJid],
      });
    } catch (err) {
      console.error("Error sending welcome message:", err);
    }
  }
}

module.exports = { getSettings, setEnabled, setMessage, handleJoin };

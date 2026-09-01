/**
 * Long-polling bot loop, started at boot from src/server.js. Thin wiring only:
 * message parsing lives here, the actual binding work is in telegramBindService.
 * In tests nothing calls start() — they invoke handleMessage() directly.
 */
const config = require('../config');
const telegram = require('./telegramClient');
const { redeemLinkCode } = require('./telegramBindService');

const HELP =
  'Halo! Bot ini dipakai Tekser untuk verifikasi Telegram dan OTP reset password.\n' +
  'Buka dashboard Tekser, klik "Hubungkan Telegram", lalu kirim: /start <kode>';

async function handleMessage(msg) {
  const text = (msg.text || '').trim();
  const m = /^\/start(?:@\S+)?(?:\s+(\S+))?/i.exec(text);
  if (!m) return telegram.sendMessage(msg.chat.id, HELP);
  if (!m[1]) return telegram.sendMessage(msg.chat.id, HELP);
  return redeemLinkCode(m[1], msg.chat.id, msg.chat.username);
}

function start() {
  if (!config.telegramBotToken) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN not set — Telegram features disabled (OTPs are logged, not sent)');
  } else {
    console.log('[telegram] long-polling bot started');
  }
  // MockTelegram.poll just stores the handler; RealTelegram.poll runs the loop.
  telegram.poll(handleMessage).catch((err) => console.error('[telegram] poll loop crashed', err));
}

function stop() {
  telegram.stop();
}

module.exports = { start, stop, handleMessage };

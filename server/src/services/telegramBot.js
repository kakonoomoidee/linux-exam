/**
 * Long-polling bot loop, started at boot from src/server.js. Thin wiring only:
 * command parsing lives here, the real work is in telegram*Service.js.
 * In tests nothing calls start() — they invoke handleMessage() directly.
 */
const config = require('../config');
const telegram = require('./telegramClient');
const User = require('../models/User');
const { redeemLinkCode, unlinkSelf } = require('./telegramBindService');
const passwordResetService = require('./passwordResetService');
const telegramActionService = require('./telegramActionService');

const HELP =
  'Bot Tekser. Perintah yang tersedia:\n' +
  '/start <kode> — hubungkan akun (ambil kode dari dashboard)\n' +
  '/status — lihat akun yang terhubung ke chat ini\n' +
  '/changepass — minta kode reset password\n' +
  '/unlink — putuskan koneksi Telegram (perlu konfirmasi)\n' +
  '/confirm <kode> — konfirmasi permintaan /unlink';

const NOT_LINKED = 'Chat ini belum terhubung. Kirim /start <kode> dari dashboard Tekser dulu.';

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const m = /^\/([a-z]+)(?:@\S+)?(?:\s+(.*))?$/i.exec((msg.text || '').trim());
  const cmd = m && m[1].toLowerCase();
  const arg = ((m && m[2]) || '').trim();

  switch (cmd) {
    case 'start':
      return arg ? redeemLinkCode(arg, chatId, msg.chat.username) : telegram.sendMessage(chatId, HELP);
    case 'status':
      return handleStatus(chatId);
    case 'changepass':
      return handleChangepass(chatId);
    case 'unlink':
      return handleUnlink(chatId);
    case 'confirm':
      return handleConfirm(chatId, arg);
    default:
      return telegram.sendMessage(chatId, HELP);
  }
}

async function handleStatus(chatId) {
  const user = await User.findByTelegramChatId(chatId);
  return telegram.sendMessage(
    chatId,
    user
      ? `Terhubung ke akun Tekser:\nNIM: ${user.nim}\nNama: ${user.name || '-'}`
      : 'Belum terhubung. Kirim /start <kode> dari dashboard Tekser.'
  );
}

async function handleChangepass(chatId) {
  const user = await User.findByTelegramChatId(chatId);
  if (!user) return telegram.sendMessage(chatId, NOT_LINKED);
  const r = await passwordResetService.requestResetForUser(user);
  if (r.throttled) {
    return telegram.sendMessage(chatId, 'Terlalu banyak permintaan reset. Coba lagi dalam 1 jam.');
  }
  // issueResetOtp already sent the OTP message.
}

async function handleUnlink(chatId) {
  const user = await User.findByTelegramChatId(chatId);
  if (!user) return telegram.sendMessage(chatId, NOT_LINKED);
  const r = await telegramActionService.requestActionOtp(chatId, 'unlink');
  if (r.throttled) return telegram.sendMessage(chatId, 'Terlalu banyak permintaan. Coba lagi nanti.');
  return telegram.sendMessage(
    chatId,
    `Kode konfirmasi: ${r.code}\nBalas /confirm ${r.code} untuk memutus koneksi Telegram. Berlaku 5 menit.`
  );
}

async function handleConfirm(chatId, arg) {
  if (!arg) return telegram.sendMessage(chatId, 'Format: /confirm <kode>');
  const user = await User.findByTelegramChatId(chatId);
  if (!user) return telegram.sendMessage(chatId, NOT_LINKED);
  const r = await telegramActionService.confirmActionOtp(chatId, 'unlink', arg);
  if (!r.ok) return telegram.sendMessage(chatId, 'Kode salah atau sudah kadaluarsa.');
  await unlinkSelf(user, 'telegram_confirm');
  return telegram.sendMessage(
    chatId,
    '✅ Koneksi Telegram diputus. Kirim /start <kode> dari dashboard untuk menghubungkan lagi.'
  );
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

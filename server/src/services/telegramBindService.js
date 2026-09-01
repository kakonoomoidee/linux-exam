/**
 * Telegram account binding. Self-service half: a logged-in student asks for a
 * one-time link code, then sends `/start <code>` to the bot, which lands in
 * redeemLinkCode() and stores their chat_id. Staff can also set/override the
 * binding directly (see routes/adminStudents.js) — that path audits separately.
 */
const db = require('../db/connection');
const joinCode = require('../lib/joinCode');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const telegram = require('./telegramClient');

const LINK_TTL_MIN = 10;

/** Mint a fresh single-use code for `userId`, invalidating any prior unused one. */
async function issueLinkCode(userId) {
  await db.run(`DELETE FROM telegram_link_codes WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
  const expiresAt = new Date(Date.now() + LINK_TTL_MIN * 60_000).toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await db.run(
        `INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES ($1, $2, $3) RETURNING *`,
        [joinCode.generate(), userId, expiresAt]
      );
    } catch (err) {
      if (/unique|duplicate/i.test(err.message)) continue; // code collision — retry
      throw err;
    }
  }
  throw new Error(`could not allocate a unique telegram link code for user ${userId}`);
}

/**
 * Bot side of `/start <code>`. Replies to the chat in every branch. Sets the
 * student's telegram_chat_id / telegram_username on success and writes a
 * telegram_bind_self audit row.
 */
async function redeemLinkCode(rawCode, chatId, tgUsername) {
  const code = String(rawCode || '').trim().toUpperCase();
  const row = await db.get(
    `SELECT * FROM telegram_link_codes WHERE code = $1 AND consumed_at IS NULL`,
    [code]
  );
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    return telegram.sendMessage(
      chatId,
      'Kode tidak valid atau sudah kadaluarsa. Buat kode baru dari dashboard Tekser.'
    );
  }
  await db.run(`UPDATE telegram_link_codes SET consumed_at = now() WHERE code = $1`, [row.code]);

  const user = await User.findById(row.user_id);
  if (!user) return telegram.sendMessage(chatId, 'Akun tidak ditemukan. Hubungi staff.');
  const previousChatId = user.telegram_chat_id;

  try {
    await User.setTelegramBinding(user.id, { chatId: String(chatId), username: tgUsername || null });
  } catch (err) {
    if (/unique|duplicate/i.test(err.message)) {
      return telegram.sendMessage(
        chatId,
        'Akun Telegram ini sudah terhubung ke NIM lain. Minta staff untuk memindahkannya.'
      );
    }
    throw err;
  }

  await AuditLog.record({
    actorType: 'student',
    actorId: user.id,
    action: 'telegram_bind_self',
    targetUserId: user.id,
    metadata: { chat_id: String(chatId), telegram_username: tgUsername || null, previous_chat_id: previousChatId || null },
  }).catch((e) => console.error('[audit] telegram_bind_self', e));

  return telegram.sendMessage(
    chatId,
    `✅ Akun Tekser (NIM ${user.nim}) berhasil terhubung. OTP reset password akan dikirim ke sini.`
  );
}

/**
 * Clear a student's Telegram binding and audit it. Shared by the website
 * `DELETE /api/me/telegram` route (`source:'web'`) and the bot's OTP-confirmed
 * `/unlink` → `/confirm` flow (`source:'telegram_confirm'`).
 */
async function unlinkSelf(user, source) {
  const previousChatId = user.telegram_chat_id;
  await User.setTelegramBinding(user.id, { chatId: null, username: null });
  await AuditLog.record({
    actorType: 'student',
    actorId: user.id,
    action: 'telegram_unlink_self',
    targetUserId: user.id,
    metadata: { previous_chat_id: previousChatId || null, source },
  }).catch((e) => console.error('[audit] telegram_unlink_self', e));
}

module.exports = { issueLinkCode, redeemLinkCode, unlinkSelf, LINK_TTL_MIN };

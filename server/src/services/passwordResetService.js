/**
 * Forgot-password via Telegram OTP. Mirrors lockService.js: an in-memory fixed-window
 * throttle (Map keyed by NIM) plus a _resetState() test hook, since the DB is
 * truncated per test but module state is not.
 *
 * Enumeration safety: requestReset() is called fire-and-forget from the route AFTER
 * the generic response is flushed, so timing never distinguishes unknown NIM /
 * unbound NIM / OTP-sent. completeReset() always runs exactly one bcrypt compare
 * (dummy hash when no OTP is pending) for the same reason, and collapses every auth
 * failure to a bare { ok: false }.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const config = require('../config');
const { hash, verify } = require('../lib/password');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const telegram = require('./telegramClient');

const MIN_PASSWORD_LENGTH = 8;

// Timing filler so "no OTP pending" costs the same as a real compare.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

// nim -> { count, windowStart }
const requests = new Map();
const verifies = new Map();
const MAX_REQ = 3;
const REQ_WINDOW_MS = 60 * 60_000; // 1 hour
const MAX_VERIFY = 5;
const VERIFY_WINDOW_MS = 10 * 60_000; // 10 minutes

function throttled(map, key, max, windowMs) {
  const a = map.get(key);
  if (!a || Date.now() - a.windowStart > windowMs) return false;
  return a.count >= max;
}

function noteAttempt(map, key, windowMs) {
  const a = map.get(key);
  if (!a || Date.now() - a.windowStart > windowMs) {
    map.set(key, { count: 1, windowStart: Date.now() });
  } else {
    a.count += 1;
  }
}

/**
 * Generate + send an OTP if `rawNim` is a real, Telegram-bound student. Silent in
 * every branch (the caller has already responded generically). Never throws to
 * the caller — the route wraps it in .catch().
 */
async function requestReset(rawNim) {
  const nim = String(rawNim || '').trim();
  if (!nim) return;
  if (throttled(requests, nim, MAX_REQ, REQ_WINDOW_MS)) return;
  noteAttempt(requests, nim, REQ_WINDOW_MS);

  const user = await User.findByNim(nim);
  if (!user || user.role !== 'student' || !user.telegram_chat_id) return;

  // Invalidate any pending OTP, then drop already-consumed rows for this user.
  // ponytail: self-clean per user on each request — no cron/sweep.
  await db.run(
    `UPDATE password_reset_otps SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
    [user.id]
  );
  await db.run(`DELETE FROM password_reset_otps WHERE user_id = $1 AND consumed_at IS NOT NULL`, [user.id]);

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const expiresAt = new Date(Date.now() + config.otpTtlMinutes * 60_000).toISOString();
  await db.run(
    `INSERT INTO password_reset_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, await hash(code), expiresAt]
  );

  await telegram.sendMessage(
    user.telegram_chat_id,
    `Kode reset password Tekser kamu: ${code}\nBerlaku ${config.otpTtlMinutes} menit. Jangan bagikan ke siapa pun.`
  );
  await AuditLog.record({
    actorType: 'student',
    actorId: user.id,
    action: 'password_reset_requested',
    targetUserId: user.id,
  }).catch((err) => console.error('[audit] password_reset_requested', err));
}

/**
 * Verify an OTP and set the new password. Returns:
 *   { ok: true }              - password changed
 *   { ok: false, reason:'weak' } - OTP was valid but the new password fails policy
 *   { ok: false }             - anything else (unknown NIM, wrong/expired/absent OTP, throttled)
 */
async function completeReset(rawNim, otp, newPassword) {
  const nim = String(rawNim || '').trim();
  if (throttled(verifies, nim, MAX_VERIFY, VERIFY_WINDOW_MS)) return { ok: false };

  const user = await User.findByNim(nim);
  const row =
    user && user.role === 'student'
      ? await db.get(
          `SELECT * FROM password_reset_otps
             WHERE user_id = $1 AND consumed_at IS NULL
             ORDER BY id DESC LIMIT 1`,
          [user.id]
        )
      : null;
  const fresh = row && Date.parse(row.expires_at) > Date.now();

  // Always one bcrypt compare, regardless of whether a row exists.
  const okOtp = await verify(String(otp || ''), fresh ? row.otp_hash : DUMMY_HASH);
  if (!user || user.role !== 'student' || !fresh || !okOtp) {
    noteAttempt(verifies, nim, VERIFY_WINDOW_MS);
    return { ok: false };
  }

  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak' };
  if (String(newPassword) === String(user.nim)) return { ok: false, reason: 'weak' };

  await db.run(`UPDATE password_reset_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
  await User.setPassword(user.id, await hash(String(newPassword)));
  verifies.delete(nim);
  requests.delete(nim);
  await AuditLog.record({
    actorType: 'student',
    actorId: user.id,
    action: 'password_reset_completed',
    targetUserId: user.id,
  }).catch((err) => console.error('[audit] password_reset_completed', err));
  return { ok: true };
}

function _resetState() {
  requests.clear();
  verifies.clear();
}

module.exports = { requestReset, completeReset, _resetState, MIN_PASSWORD_LENGTH };

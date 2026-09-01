/**
 * One-time codes that confirm a sensitive Telegram-side action (currently only
 * `/unlink`). Deliberately a SEPARATE table + service from password-reset OTPs so
 * the two can never be interchanged — an `/unlink` code is structurally unable to
 * authorize a password reset and vice-versa.
 *
 * Same shape as passwordResetService: in-memory fixed-window throttle keyed by
 * `${chatId}:${action}`, `_resetState()` for tests, one bcrypt compare per verify
 * (DUMMY_HASH filler when no code is pending), a fresh request consumes any pending
 * code.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { hash, verify } = require('../lib/password');

const ACTION_TTL_MIN = 5;

const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

// `${chatId}:${action}` -> { count, windowStart }
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
 * Mint a fresh 6-digit code for (chatId, action). Invalidates any pending code
 * for the same pair first — same lifecycle as passwordResetService.issueResetOtp.
 * Returns { code } or { throttled: true }.
 */
async function requestActionOtp(chatId, action) {
  const key = `${chatId}:${action}`;
  if (throttled(requests, key, MAX_REQ, REQ_WINDOW_MS)) return { throttled: true };
  noteAttempt(requests, key, REQ_WINDOW_MS);

  await db.run(
    `UPDATE telegram_action_otps SET consumed_at = now()
       WHERE chat_id = $1 AND action = $2 AND consumed_at IS NULL`,
    [String(chatId), action]
  );
  await db.run(
    `DELETE FROM telegram_action_otps
       WHERE chat_id = $1 AND action = $2 AND consumed_at IS NOT NULL`,
    [String(chatId), action]
  );

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const expiresAt = new Date(Date.now() + ACTION_TTL_MIN * 60_000).toISOString();
  await db.run(
    `INSERT INTO telegram_action_otps (chat_id, action, otp_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [String(chatId), action, await hash(code), expiresAt]
  );
  return { code };
}

/**
 * Verify a code the user replied with. Returns { ok:true } on a fresh, matching,
 * unconsumed code (which it then consumes), else { ok:false } — wrong, expired,
 * absent, or throttled all collapse to the same result.
 */
async function confirmActionOtp(chatId, action, otp) {
  const key = `${chatId}:${action}`;
  if (throttled(verifies, key, MAX_VERIFY, VERIFY_WINDOW_MS)) return { ok: false };

  const row = await db.get(
    `SELECT * FROM telegram_action_otps
       WHERE chat_id = $1 AND action = $2 AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    [String(chatId), action]
  );
  const fresh = row && Date.parse(row.expires_at) > Date.now();

  const okOtp = await verify(String(otp || ''), fresh ? row.otp_hash : DUMMY_HASH);
  if (!fresh || !okOtp) {
    noteAttempt(verifies, key, VERIFY_WINDOW_MS);
    return { ok: false };
  }

  await db.run(`UPDATE telegram_action_otps SET consumed_at = now() WHERE id = $1`, [row.id]);
  verifies.delete(key);
  requests.delete(key);
  return { ok: true };
}

function _resetState() {
  requests.clear();
  verifies.clear();
}

module.exports = { requestActionOtp, confirmActionOtp, _resetState, ACTION_TTL_MIN };

const express = require('express');
const config = require('../config');
const { requireAuth, requirePasswordChanged, signToken } = require('../middleware/auth');
const { hash, checkStudentPassword } = require('../lib/password');
const db = require('../db/connection');
const Question = require('../models/Question');
const Session = require('../models/Session');
const User = require('../models/User');
const { Submission } = require('../models/Submission');
const AuditLog = require('../models/AuditLog');
const examService = require('../services/examService');
const timerService = require('../services/timerService');
const telegramBindService = require('../services/telegramBindService');
const telegramActionService = require('../services/telegramActionService');
const telegram = require('../services/telegramClient');

const router = express.Router();
router.use(requireAuth);

const MIN_PASSWORD_LENGTH = 8;

/** Shared new-password policy for every change-password path. Returns an error string or null. */
function newPasswordError(newPassword, user) {
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter`;
  }
  if (String(newPassword) === String(user.nim)) {
    return 'Password baru tidak boleh sama dengan NIM';
  }
  return null;
}

/**
 * Forced first-login password change. Single-factor (current password only) by
 * design — the student is still on the default password and has no Telegram bound.
 * Mounted BEFORE requirePasswordChanged so a student who still must change their
 * password can reach exactly this one endpoint.
 */
router.post('/me/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Hanya untuk mahasiswa' });

  if (!(await checkStudentPassword(user, currentPassword))) {
    return res.status(400).json({ error: 'Password saat ini salah' });
  }
  const err = newPasswordError(newPassword, user);
  if (err) return res.status(400).json({ error: err });

  const updated = await User.setPassword(user.id, await hash(String(newPassword)));
  res.json({ token: signToken(updated) }); // fresh token, mustChangePassword now false
});

/**
 * Voluntary change-password, step 1: send a Telegram OTP as the second factor.
 * The current password is verified first, so a wrong password never triggers a
 * code. Reuses telegramActionService (action 'change_password') — same primitive
 * as the bot's /unlink confirmation, separate from forgot-password OTPs.
 */
router.post('/me/password/change-otp', async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Hanya untuk mahasiswa' });
  if (!(await checkStudentPassword(user, req.body.currentPassword))) {
    return res.status(400).json({ error: 'Password saat ini salah' });
  }
  if (!user.telegram_chat_id) return res.status(409).json({ error: 'telegram_not_linked' });

  const r = await telegramActionService.requestActionOtp(user.telegram_chat_id, 'change_password');
  if (r.throttled) return res.status(429).json({ error: 'Terlalu banyak permintaan kode. Coba lagi nanti.' });

  await telegram.sendMessage(
    user.telegram_chat_id,
    `Kode ganti password Tekser kamu: ${r.code}\nBerlaku ${telegramActionService.ACTION_TTL_MIN} menit. Abaikan jika ini bukan kamu.`
  );
  res.json({ sent: true });
});

/**
 * Voluntary change-password, step 2: current password + the Telegram OTP together.
 */
router.post('/me/password/verified', async (req, res) => {
  const { currentPassword, newPassword, otp } = req.body;
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Hanya untuk mahasiswa' });
  if (!(await checkStudentPassword(user, currentPassword))) {
    return res.status(400).json({ error: 'Password saat ini salah' });
  }
  if (!user.telegram_chat_id) return res.status(409).json({ error: 'telegram_not_linked' });

  // Validate the new password before spending the OTP, so a policy miss doesn't
  // force the student to request a fresh code.
  const err = newPasswordError(newPassword, user);
  if (err) return res.status(400).json({ error: err });

  const { ok } = await telegramActionService.confirmActionOtp(user.telegram_chat_id, 'change_password', otp);
  if (!ok) return res.status(400).json({ error: 'Kode OTP salah atau sudah kadaluarsa' });

  const updated = await User.setPassword(user.id, await hash(String(newPassword)));
  AuditLog.record({
    actorType: 'student',
    actorId: user.id,
    action: 'password_changed_2fa',
    targetUserId: user.id,
  }).catch((e) => console.error('[audit] password_changed_2fa', e));
  res.json({ token: signToken(updated) });
});

// Everything below is off-limits until the default password has been changed.
router.use(requirePasswordChanged);

/** Current Telegram binding state for the sidebar entry. `botUsername` lets the UI
 *  show a persistent "Bot: @..." link without opening the connect modal first. */
router.get('/me/telegram', async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({
    linked: !!(user && user.telegram_chat_id),
    username: (user && user.telegram_username) || null,
    botUsername: config.telegramBotUsername,
  });
});

/** Mint a one-time code the student sends to the bot as `/start <code>`. */
router.post('/me/telegram/link-code', async (req, res) => {
  const row = await telegramBindService.issueLinkCode(req.user.id);
  res.json({ code: row.code, expiresAt: row.expires_at, botUsername: config.telegramBotUsername });
});

/**
 * Self-unlink. Safe: a logged-in student removing their own binding grants no
 * access, and re-linking still needs a valid session + a fresh code.
 */
router.delete('/me/telegram', async (req, res) => {
  const user = await User.findById(req.user.id);
  await telegramBindService.unlinkSelf(user, 'web');
  res.json({ linked: false });
});

/** The active session + question list + live progress for the logged-in student. */
router.get('/me/active-participant', async (req, res) => {
  const participant = await db.get(
    `SELECT sp.*, s.ucp, s.started_at AS session_started_at, s.duration_minutes AS session_duration_minutes
     FROM session_participants sp
     JOIN sessions s ON s.id = sp.session_id
     WHERE sp.user_id = $1 AND s.status = 'running'
       AND sp.container_status NOT IN ('not_started', 'provisioning', 'destroyed', 'ended', 'ending')
     ORDER BY sp.id DESC LIMIT 1`,
    [req.user.id]
  );

  // Only 'active' (ready to connect) or 'error' (needs a visible failure, not a
  // silent hang) get past that filter. While a container is still being built
  // the client just keeps polling — same mechanism as the "waiting" screen.
  if (!participant) return res.status(404).json({ error: 'Tidak ada sesi aktif' });

  const questions = (await Question.listForVariantIndex(participant.variant_index, participant.ucp)).map((q) => ({
    id: q.id,
    order_index: q.order_index,
    story_text: q.story_text, // kept for back-compat; = the Indonesian version
    story_text_id: q.story_text,
    story_text_en: q.story_text_en || q.story_text, // fall back to ID so it's never blank
    point: q.point,
    level: q.level,
  })); // accepted_patterns / checker script intentionally withheld from the client

  const submissions = await Submission.listForParticipant(participant.id);

  // Session-wide deadline (started_at + duration), same for every participant.
  const deadline = participant.session_started_at
    ? new Date(participant.session_started_at).getTime() +
      participant.session_duration_minutes * 60000
    : null;

  res.json({
    participant,
    questions,
    submissions,
    remainingMs: deadline ? timerService.remainingMs(deadline) : null,
  });
});

/**
 * Join a session with its join code. Response taxonomy, in order (order matters
 * for the anti-fishing property):
 *   1. no session has that code            -> generic 403
 *   2. code ok but caller not on roster    -> generic 403, byte-identical to (1)
 *      (1 & 2 must stay indistinguishable so nobody can probe for valid codes
 *       or for which NIMs are enrolled)
 *   3. code + roster ok, status 'pending'  -> 202 { status: 'pending' } — the
 *      code is minted at creation so students can queue up before "Mulai Ujian"
 *   4. code + roster ok, status 'running'  -> the atomic claim + provisioning
 *   5. code + roster ok, exam over (ended, or running past the session-wide
 *      deadline)                            -> 403 "Waktu ujian sudah berakhir"
 * Cases 3 & 5 only reveal the real state to a caller who has already proven
 * both the (unguessable) code and roster membership, so they leak nothing.
 */
router.post('/me/join', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();

  const session = code
    ? await db.get('SELECT * FROM sessions WHERE join_code = $1', [code])
    : null;
  const participant = session
    ? await db.get(
        'SELECT * FROM session_participants WHERE session_id = $1 AND user_id = $2',
        [session.id, req.user.id]
      )
    : null;

  // Cases 1 & 2.
  if (!session || !participant) {
    return res.status(403).json({ error: 'Kode tidak valid atau kamu tidak terdaftar untuk sesi ini' });
  }

  // Case 5: the exam is over — ended, or still 'running' but past the
  // session-wide deadline (started_at + duration_minutes).
  const pastDeadline =
    session.started_at &&
    Date.now() > new Date(session.started_at).getTime() + session.duration_minutes * 60000;
  if (session.status === 'ended' || pastDeadline) {
    return res.status(403).json({ error: 'Waktu ujian sudah berakhir' });
  }

  // Case 3: created but not started yet. Hold the student on a waiting screen;
  // they'll re-poll and get in automatically once "Mulai Ujian" is clicked. No
  // provisioning here — that stays lazy and only happens for status 'running'.
  if (session.status !== 'running') {
    return res.status(202).json({ status: 'pending', message: 'Sesi belum dimulai. Menunggu instruktur memulai ujian.' });
  }

  // Case 4. Atomically claim this participant for provisioning BEFORE responding. A second
  // fast click / Enter loses the claim here instead of slipping past a
  // check-then-act guard and kicking off a duplicate provision — which would mint
  // a second session_token and leave the browser holding a stale one.
  // A fresh row or a previously failed ('error') / torn-down ('destroyed') one is
  // (re)claimable; 'provisioning'/'active'/'ending'/'ended' is a no-op rejoin.
  const claimed = await db.run(
    `UPDATE session_participants SET container_status = 'provisioning'
     WHERE id = $1 AND container_status NOT IN ('provisioning', 'active', 'ending', 'ended')
     RETURNING id`,
    [participant.id]
  );

  res.status(202).json({ ok: true });

  if (!claimed) return;
  examService
    .provisionOne(await Session.getParticipant(participant.id), session)
    .catch((err) => console.error(`[student] join provision failed for participant ${participant.id}`, err));
});

/** This student's own past sessions + final score. Scoped to req.user.id, never a passed id. */
router.get('/me/history', async (req, res) => {
  const rows = await db.all(
    `SELECT s.id AS session_id, s.name AS session_name, s.started_at, s.created_at,
            COALESCE(SUM(COALESCE(sub.final_score, sub.auto_score)), 0) AS score
       FROM session_participants sp
       JOIN sessions s ON s.id = sp.session_id
       LEFT JOIN submissions sub ON sub.participant_id = sp.id
      WHERE sp.user_id = $1
      GROUP BY s.id
      ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

/** Student marks "I'm done" before the timer runs out. */
router.post('/me/submit', async (req, res) => {
  const participant = await db.get(
    'SELECT * FROM session_participants WHERE user_id = $1 AND container_status = $2',
    [req.user.id, 'active']
  );
  if (!participant) return res.status(400).json({ error: 'Tidak ada sesi aktif untuk di-submit' });

  await examService.submitParticipant(participant.id);
  res.json({ message: 'Submitted' });
});

module.exports = router;

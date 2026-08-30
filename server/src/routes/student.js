const express = require('express');
const { requireAuth, requirePasswordChanged, signToken } = require('../middleware/auth');
const { hash, checkStudentPassword } = require('../lib/password');
const db = require('../db/connection');
const Question = require('../models/Question');
const Session = require('../models/Session');
const User = require('../models/User');
const { Submission } = require('../models/Submission');
const examService = require('../services/examService');
const timerService = require('../services/timerService');

const router = express.Router();
router.use(requireAuth);

const MIN_PASSWORD_LENGTH = 8;

/**
 * Change password. Mounted BEFORE requirePasswordChanged so a student who still
 * must change their password can reach exactly this one endpoint.
 */
router.post('/me/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id);
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Hanya untuk mahasiswa' });

  if (!(await checkStudentPassword(user, currentPassword))) {
    return res.status(400).json({ error: 'Password saat ini salah' });
  }
  if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password baru minimal ${MIN_PASSWORD_LENGTH} karakter` });
  }
  if (String(newPassword) === String(user.nim)) {
    return res.status(400).json({ error: 'Password baru tidak boleh sama dengan NIM' });
  }

  const updated = await User.setPassword(user.id, await hash(String(newPassword)));
  res.json({ token: signToken(updated) }); // fresh token, mustChangePassword now false
});

// Everything below is off-limits until the default password has been changed.
router.use(requirePasswordChanged);

/** The active session + question list + live progress for the logged-in student. */
router.get('/me/active-participant', async (req, res) => {
  const participant = await db.get(
    `SELECT sp.*, s.ucp FROM session_participants sp
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

  res.json({
    participant,
    questions,
    submissions,
    remainingMs: participant.ends_at ? timerService.remainingMs(participant.ends_at) : null,
  });
});

/**
 * Join a running session with its join code. Two checks, one indistinguishable
 * rejection: the code must match a running session AND the caller's NIM must be
 * on that session's roster. Wrong code, not-on-roster and already-ended all look
 * identical so nobody can fish for valid codes.
 */
router.post('/me/join', async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();

  const session = code
    ? await db.get("SELECT * FROM sessions WHERE join_code = $1 AND status = 'running'", [code])
    : null;
  const participant = session
    ? await db.get(
        'SELECT * FROM session_participants WHERE session_id = $1 AND user_id = $2',
        [session.id, req.user.id]
      )
    : null;

  if (!session || !participant) {
    return res.status(403).json({ error: 'Kode tidak valid atau kamu tidak terdaftar untuk sesi ini' });
  }

  // Atomically claim this participant for provisioning BEFORE responding. A second
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

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db/connection');
const Question = require('../models/Question');
const { Submission } = require('../models/Submission');
const examService = require('../services/examService');
const timerService = require('../services/timerService');

const router = express.Router();
router.use(requireAuth);

/** The active session + question list + live progress for the logged-in student. */
router.get('/me/active-participant', async (req, res) => {
  const participant = await db.get(
    `SELECT sp.* FROM session_participants sp
     JOIN sessions s ON s.id = sp.session_id
     WHERE sp.user_id = $1 AND s.status = 'running'
       AND sp.container_status NOT IN ('destroyed', 'ended', 'ending')
     ORDER BY sp.id DESC LIMIT 1`,
    [req.user.id]
  );

  if (!participant) return res.status(404).json({ error: 'Tidak ada sesi aktif' });

  const questions = (await Question.listForVariantIndex(participant.variant_index)).map((q) => ({
    id: q.id,
    order_index: q.order_index,
    story_text: q.story_text,
    point: q.point,
  })); // accepted_patterns / checker script intentionally withheld from the client

  const submissions = await Submission.listForParticipant(participant.id);

  res.json({
    participant,
    questions,
    submissions,
    remainingMs: participant.ends_at ? timerService.remainingMs(participant.ends_at) : null,
  });
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

const express = require('express');
const db = require('../db/connection');
const Session = require('../models/Session');
const Question = require('../models/Question');
const { CommandLog, Submission } = require('../models/Submission');
const evaluator = require('../services/evaluatorService');

const router = express.Router();

/**
 * Called from inside the student's container (PROMPT_COMMAND hook, see
 * docker/bashrc-hook.sh) after every command. Authenticated by the
 * per-participant session_token baked into the container's environment —
 * NOT a JWT, since the container has no way to hold a browser session.
 */
router.post('/', async (req, res) => {
  const { session_token, cmd, exit_code } = req.body;
  if (!session_token || cmd === undefined) {
    return res.status(400).json({ error: 'session_token dan cmd wajib diisi' });
  }

  const participant = await Session.findParticipantByToken(session_token);
  if (!participant || participant.container_status !== 'active') {
    return res.status(403).json({ error: 'Sesi tidak aktif' });
  }

  const normalized = evaluator.normalizeCommand(cmd);
  const questions = await Question.listForVariantIndex(participant.variant_index, participant.ucp);
  const solvedRows = await db.all(
    `SELECT question_id FROM submissions WHERE participant_id = $1 AND auto_result = 'pass'`,
    [participant.id]
  );
  const solvedIds = new Set(solvedRows.map((r) => r.question_id));
  const unsolved = questions.filter((q) => !solvedIds.has(q.id));

  const match = evaluator.evaluateCommandAgainstQuestions(normalized, exit_code, unsolved);

  const logEntry = await CommandLog.create({
    participant_id: participant.id,
    question_id: match ? match.question.id : participant.active_question_id,
    raw_command: cmd,
    normalized_command: normalized,
    exit_code,
  });

  if (match) {
    await Submission.markAutoResult(participant.id, match.question.id, {
      auto_result: 'pass',
      auto_score: match.question.point,
      matched_command_log_id: logEntry.id,
    });
    await emitScoreUpdate(participant, match.question);
  }

  res.json({ ok: true, matched: Boolean(match) });
});

async function emitScoreUpdate(participant, question) {
  const submissions = await Submission.listForParticipant(participant.id);
  const solvedCount = submissions.filter((s) => s.auto_result === 'pass').length;
  const io = require('../sockets').getIo();
  if (!io) return;
  io.to(`participant:${participant.session_token}`).emit('exam:score_update', {
    questionId: question.id,
    orderIndex: question.order_index,
    point: question.point,
    solvedCount,
    totalQuestions: submissions.length,
  });
  io.to('admin-dashboard').emit('admin:score_update', {
    participantId: participant.id,
    nim: participant.nim,
    questionId: question.id,
    solvedCount,
    totalQuestions: submissions.length,
  });
}

module.exports = router;

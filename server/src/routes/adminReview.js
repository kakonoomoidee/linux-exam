const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const Session = require('../models/Session');
const Question = require('../models/Question');
const { Submission, CommandLog } = require('../models/Submission');
const lockService = require('../services/lockService');

const router = express.Router();
router.use(requireAdmin);

/** Anti-cheat: assistant unlocks a locked participant without them typing the
 * code (false positive, or just faster than reading it out). */
router.post('/participants/:participantId/force-unlock', async (req, res) => {
  const participant = await Session.getParticipant(req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Peserta tidak ditemukan' });

  await lockService.forceUnlock(participant.id);
  const io = require('../sockets').getIo();
  if (io) {
    io.to(`participant:${participant.session_token}`).emit('exam:unlocked', {});
    io.to('admin-dashboard').emit('admin:unlocked', { participantId: participant.id, nim: participant.nim });
  }
  res.json({ ok: true });
});

/** Full review board for one session x one question: every participant's
 * auto result + their full command log for that question, ready to override. */
router.get('/sessions/:sessionId/questions/:questionId', async (req, res) => {
  const { sessionId, questionId } = req.params;
  const question = await Question.findById(questionId);
  if (!question) return res.status(404).json({ error: 'Soal tidak ditemukan' });

  const base = await Submission.listForSessionQuestion(sessionId, questionId);
  const rows = await Promise.all(
    base.map(async (s) => ({
      ...s,
      command_log: await CommandLog.listForParticipantQuestion(s.participant_id, questionId),
    }))
  );

  res.json({ question, submissions: rows });
});

/** Manual override: score is a fraction 0/0.25/0.5/0.75/1 of the question's point value. */
router.patch('/submissions/:participantId/:questionId', async (req, res) => {
  const { participantId, questionId } = req.params;
  const { fraction } = req.body; // 0, 0.25, 0.5, 0.75, 1
  if (![0, 0.25, 0.5, 0.75, 1].includes(fraction)) {
    return res.status(400).json({ error: 'fraction harus salah satu dari 0, 0.25, 0.5, 0.75, 1' });
  }
  const question = await Question.findById(questionId);
  const finalScore = fraction * question.point;
  const updated = await Submission.overrideScore(participantId, questionId, finalScore, req.user.id);
  res.json(updated);
});

/** Bulk-accept: apply auto_score as final_score for every submission still un-reviewed for a question. */
router.post('/sessions/:sessionId/questions/:questionId/bulk-accept-auto', async (req, res) => {
  const { sessionId, questionId } = req.params;
  const rows = await Submission.listForSessionQuestion(sessionId, questionId);
  const pending = rows.filter((s) => s.final_score === null || s.final_score === undefined);
  for (const s of pending) {
    await Submission.overrideScore(s.participant_id, questionId, s.auto_score, req.user.id);
  }
  res.json({ updatedCount: pending.length });
});

/** Per-participant full result (used for final grade export / participant detail view). */
router.get('/participants/:participantId', async (req, res) => {
  const participant = await Session.getParticipant(req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Peserta tidak ditemukan' });
  const submissions = await Submission.listForParticipant(participant.id);
  const total = submissions.reduce(
    (sum, s) => sum + (s.final_score !== null && s.final_score !== undefined ? s.final_score : s.auto_score),
    0
  );
  res.json({ participant, submissions, total });
});

/**
 * Grade sheet for one session: every participant with their solved/total
 * question count and running total score (final_score where reviewed,
 * auto_score otherwise) — the data behind the admin "Mahasiswa & Nilai" tab.
 */
router.get('/sessions/:sessionId/grades', async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

  const participants = await Session.listParticipants(session.id);
  const rows = await Promise.all(
    participants.map(async (p) => {
      const submissions = await Submission.listForParticipant(p.id);
      const total = submissions.reduce((sum, s) => sum + (s.final_score ?? s.auto_score), 0);
      const maxTotal = submissions.reduce((sum, s) => sum + s.point, 0);
      const solvedCount = submissions.filter((s) => s.auto_result === 'pass').length;
      const reviewedCount = submissions.filter((s) => s.final_score !== null && s.final_score !== undefined).length;
      return {
        participant_id: p.id,
        nim: p.nim,
        name: p.name,
        variant_index: p.variant_index,
        container_status: p.container_status,
        solvedCount,
        totalQuestions: submissions.length,
        reviewedCount,
        total,
        maxTotal,
      };
    })
  );

  res.json({ session, rows });
});

/**
 * Full raw command history for one participant, unfiltered by question — including
 * typos and unmatched attempts that never scored. This is the safety net for
 * reviewing "hampir benar" cases the per-question log can miss (e.g. a typo
 * right before the correct command, see adminReview per-question view).
 */
router.get('/participants/:participantId/command-log', async (req, res) => {
  const participant = await Session.getParticipant(req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Peserta tidak ditemukan' });
  res.json(await CommandLog.listForParticipant(participant.id));
});

/**
 * Full session transcript: every command every participant typed, time-ordered
 * and interleaved, showing which question each one matched (if any). The
 * "what did this student do the whole exam" view without clicking through
 * every question × participant.
 */
router.get('/sessions/:sessionId/transcript', async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  const entries = await CommandLog.listForSession(session.id);
  res.json({ session, entries });
});

/** CSV export for the whole session, ready for the campus academic system. */
router.get('/sessions/:sessionId/export.csv', async (req, res) => {
  const participants = await Session.listParticipants(req.params.sessionId);
  const rows = await Promise.all(
    participants.map(async (p) => {
      const submissions = await Submission.listForParticipant(p.id);
      const total = submissions.reduce((sum, s) => sum + (s.final_score ?? s.auto_score), 0);
      const perQuestion = submissions.map((s) => (s.final_score ?? s.auto_score)).join(',');
      return `${p.nim},${p.name || ''},${total},${perQuestion}`;
    })
  );
  const header = 'nim,nama,total_nilai,nilai_per_soal';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=session-${req.params.sessionId}-nilai.csv`);
  res.send([header, ...rows].join('\n'));
});

module.exports = router;

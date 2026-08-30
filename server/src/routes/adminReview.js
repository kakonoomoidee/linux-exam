const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const Session = require('../models/Session');
const Question = require('../models/Question');
const { Submission, CommandLog } = require('../models/Submission');

const router = express.Router();
router.use(requireAdmin);

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

/** Kelas values present in a session, for the "Per Kelas" review picker. */
router.get('/sessions/:sessionId/kelas', async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  res.json({ kelas: await Session.listKelasForSession(session.id) });
});

/**
 * "Per Kelas" review: one continuous read of everything a kelas did in a
 * session, grouped by variant (a kelas spans many NIM-derived variants), then
 * by question in order, then every student's result for it. Reuses the
 * per-question command-log fetch.
 * ponytail: N+1 command-log fetch per (student, question); fine at exam scale
 * (one kelas ≈ ≤30 students × ~5 questions). Batch if a kelas ever tops ~50.
 */
router.get('/sessions/:sessionId/kelas/:kelas', async (req, res) => {
  const session = await Session.findById(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  const kelas = String(req.params.kelas).toUpperCase();

  const flat = await Submission.listForSessionKelas(session.id, kelas);

  // flat is ordered variant_index, order_index, nim -> chunk it up.
  const groups = [];
  const byVariant = new Map();
  for (const row of flat) {
    if (!byVariant.has(row.variant_index)) {
      const g = { variant_index: row.variant_index, questions: [] };
      byVariant.set(row.variant_index, g);
      groups.push(g);
    }
    const group = byVariant.get(row.variant_index);
    let q = group.questions.find((x) => x.id === row.question_id);
    if (!q) {
      q = {
        id: row.question_id,
        order_index: row.order_index,
        story_text: row.story_text,
        story_text_en: row.story_text_en,
        point: row.point,
        check_type: row.check_type,
        accepted_patterns: row.accepted_patterns,
        ucp: row.ucp,
        submissions: [],
      };
      group.questions.push(q);
    }
    q.submissions.push({
      participant_id: row.participant_id,
      nim: row.nim,
      name: row.name,
      auto_result: row.auto_result,
      auto_score: row.auto_score,
      final_score: row.final_score,
      matched_command_log_id: row.matched_command_log_id,
      command_log: await CommandLog.listForParticipantQuestion(row.participant_id, row.question_id),
    });
  }

  res.json({ session, kelas, groups });
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
        kelas: p.kelas,
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
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
router.get('/sessions/:sessionId/export.csv', async (req, res) => {
  const participants = await Session.listParticipants(req.params.sessionId);
  const rows = await Promise.all(
    participants.map(async (p) => {
      const submissions = await Submission.listForParticipant(p.id);
      const total = submissions.reduce((sum, s) => sum + (s.final_score ?? s.auto_score), 0);
      const perQuestion = submissions.map((s) => (s.final_score ?? s.auto_score)).join(',');
      return `${csvCell(p.nim)},${csvCell(p.name)},${csvCell(p.kelas)},${total},${perQuestion}`;
    })
  );
  const header = 'nim,nama,kelas,total_nilai,nilai_per_soal';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=session-${req.params.sessionId}-nilai.csv`);
  res.send([header, ...rows].join('\n'));
});

module.exports = router;

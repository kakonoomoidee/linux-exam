/**
 * Data behind "Review Nilai" v2 (session list -> students -> one student).
 * Loads a whole session in four queries, then runs near-miss detection and the
 * shared grade summary per participant. Exports reuse analyzeSession() so the
 * numbers in the file are the numbers on screen.
 */
const Session = require('../models/Session');
const Question = require('../models/Question');
const AuditLog = require('../models/AuditLog');
const { Submission, CommandLog } = require('../models/Submission');
const { classifyAnswer, needsAttention } = require('./nearMissService');
const { buildAnswerKey } = require('./answerKeyService');
const { summarizeScores, isReviewed, scoreForPercent, percentForScore } = require('./gradeService');
const { summarizeSession } = require('./reviewSummaryService');

class ReviewNotFoundError extends Error {}

const groupBy = (items, keyOf) => {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};

async function loadSessionContext(sessionId) {
  const session = await Session.findById(sessionId);
  if (!session) return null;
  const [participants, questions, submissions, commands] = await Promise.all([
    Session.listParticipants(session.id),
    Question.listForUcp(session.ucp),
    Submission.listForSession(session.id),
    CommandLog.listRawForSession(session.id),
  ]);
  return {
    session,
    participants,
    questionsByVariant: groupBy(questions, (q) => q.variant_index),
    subsByParticipant: groupBy(submissions, (s) => s.participant_id),
    cmdsByParticipant: groupBy(commands, (c) => c.participant_id),
  };
}

function analyzeParticipant(ctx, participant) {
  const questions = ctx.questionsByVariant.get(participant.variant_index) || [];
  const subs = ctx.subsByParticipant.get(participant.id) || [];
  const commands = ctx.cmdsByParticipant.get(participant.id) || [];
  const rows = questions.map((question) => {
    const submission = subs.find((s) => s.question_id === question.id) || null;
    const foreignMatchIds = new Set(
      subs.filter((s) => s.question_id !== question.id && s.matched_command_log_id).map((s) => s.matched_command_log_id)
    );
    const detection = classifyAnswer({ question, submission, commands, foreignMatchIds });
    return { question, submission, detection };
  });
  const flagged = rows.filter((r) => needsAttention(r.detection.label));
  return {
    participant,
    rows,
    commands,
    scores: summarizeScores(rows),
    nearMissCount: flagged.length,
    nearMissPending: flagged.filter((r) => !isReviewed(r.submission)).length,
  };
}

async function analyzeSession(sessionId) {
  const ctx = await loadSessionContext(sessionId);
  if (!ctx) throw new ReviewNotFoundError('Sesi tidak ditemukan');
  return { session: ctx.session, analyses: ctx.participants.map((p) => analyzeParticipant(ctx, p)) };
}

const average = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null);

function sessionHeader(session) {
  const { id, name, ucp, status, started_at, created_at, duration_minutes } = session;
  return { id, name, ucp, status, started_at, created_at, duration_minutes };
}

/** Level 1: every session with participant count, average grade, pending near-misses. */
async function listSessions() {
  const sessions = await Session.listAll();
  return Promise.all(
    sessions.map(async (s) => {
      const { analyses } = await analyzeSession(s.id);
      const graded = analyses.filter((a) => a.rows.length);
      return {
        ...sessionHeader(s),
        participantCount: analyses.length,
        averageGrade: average(graded.map((a) => a.scores.finalGrade)),
        nearMissPending: analyses.reduce((sum, a) => sum + a.nearMissPending, 0),
      };
    })
  );
}

function studentRow(a) {
  const { id, nim, name, kelas, variant_index: variantIndex, container_status: containerStatus } = a.participant;
  return { participantId: id, nim, name, kelas, variantIndex, containerStatus, ...a.scores,
    questionCount: a.rows.length, nearMissCount: a.nearMissCount, nearMissPending: a.nearMissPending };
}

/** Level 2: students of one session + the session summary. */
async function sessionOverview(sessionId) {
  const { session, analyses } = await analyzeSession(sessionId);
  return { session: sessionHeader(session), students: analyses.map(studentRow), summary: summarizeSession(analyses) };
}

function questionView(q) {
  const { id, order_index, story_text, story_text_en, point, level, check_type, state_checker_script, variant_index } = q;
  return { id, order_index, story_text, story_text_en, point, level, check_type, state_checker_script, variant_index };
}

function submissionView(sub, point) {
  if (!sub) return null;
  const { auto_result, auto_score, final_score, matched_command_log_id, review_note, reviewed_at, reviewer_name } = sub;
  return { auto_result, auto_score, final_score, matched_command_log_id, review_note, reviewed_at, reviewer_name,
    finalPercent: isReviewed(sub) ? percentForScore(final_score, point) : null };
}

/** Level 3: one participant, every question with key, detection and their history. */
async function participantDetail(participantId) {
  const participant = await Session.getParticipant(participantId);
  if (!participant) throw new ReviewNotFoundError('Peserta tidak ditemukan');
  const ctx = await loadSessionContext(participant.session_id);
  const a = analyzeParticipant(ctx, ctx.participants.find((p) => p.id === participant.id) || participant);
  return {
    session: sessionHeader(ctx.session),
    student: studentRow(a),
    questions: a.rows.map((r) => ({
      question: questionView(r.question),
      key: buildAnswerKey(r.question),
      submission: submissionView(r.submission, r.question.point),
      detection: r.detection,
    })),
    commands: a.commands.map(({ id, raw_command, exit_code, created_at, question_id }) => ({
      id, raw_command, exit_code, created_at, question_id })),
  };
}

async function findParticipantQuestion(participantId, questionId) {
  const participant = await Session.getParticipant(participantId);
  if (!participant) throw new ReviewNotFoundError('Peserta tidak ditemukan');
  // Only the participant's own variant + UCP: anything else would add a stray
  // submission row that inflates their total.
  const questions = await Question.listForVariantIndex(participant.variant_index, participant.ucp);
  const question = questions.find((q) => String(q.id) === String(questionId));
  if (!question) throw new ReviewNotFoundError('Soal tidak ditemukan untuk peserta ini');
  return { participant, question };
}

function auditCorrection(action, { participant, question, reviewerId, metadata }) {
  AuditLog.record({
    actorType: 'staff',
    actorId: reviewerId,
    action,
    targetUserId: participant.user_id,
    metadata: { session_id: participant.session_id, participant_id: participant.id, question_id: question.id, ...metadata },
  }).catch((err) => console.error(`[audit] ${action}`, err));
}

/** Saves a 0/25/50/75/100% correction + note. Percent is validated by the route. */
async function saveCorrection({ participantId, questionId, percent, note, reviewerId }) {
  const { participant, question } = await findParticipantQuestion(participantId, questionId);
  const previous = await Submission.get(participant.id, question.id);
  const finalScore = scoreForPercent(percent, question.point);
  const saved = await Submission.saveReview(participant.id, question.id, { finalScore, note, reviewerId });
  auditCorrection('grade_correction', { participant, question, reviewerId,
    metadata: { percent, final_score: finalScore, previous_final_score: previous?.final_score ?? null, note: note || null } });
  return saved;
}

async function clearCorrection({ participantId, questionId, reviewerId }) {
  const { participant, question } = await findParticipantQuestion(participantId, questionId);
  const previous = await Submission.get(participant.id, question.id);
  const saved = await Submission.clearReview(participant.id, question.id);
  auditCorrection('grade_correction_cleared', { participant, question, reviewerId,
    metadata: { previous_final_score: previous?.final_score ?? null } });
  return saved;
}

module.exports = {
  ReviewNotFoundError,
  analyzeSession,
  analyzeParticipant, // pure given a loaded context; reused by offline analysis
  listSessions,
  sessionOverview,
  participantDetail,
  saveCorrection,
  clearCorrection,
};

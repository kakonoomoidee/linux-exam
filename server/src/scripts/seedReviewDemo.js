/**
 * Dev-only: seeds two ENDED dummy sessions with graded command history so the
 * Review Nilai v2 pages have something realistic to show (correct / near-miss
 * / wrong mix). Commands go through the real grader exactly like
 * routes/cmdLog.js does. Re-running replaces the previous [DEMO] sessions.
 *
 *   npm run seed:review-demo        (refuses to run with NODE_ENV=production)
 */
const migrate = require('../db/migrate');
const db = require('../db/connection');
const Question = require('../models/Question');
const User = require('../models/User');
const Session = require('../models/Session');
const { Submission } = require('../models/Submission');
const evaluator = require('../services/evaluatorService');
const { bank, students, sessions } = require('./reviewDemoData');

const DEMO_PREFIX = '[DEMO]';
const SECONDS_BETWEEN_COMMANDS = 25;
const DURATION_MINUTES = 7;

async function gradeCommands(participant, questions, student, startedAt) {
  const solved = new Set();
  for (const [i, [cmd, exitCode]] of student.cmds.entries()) {
    const normalized = evaluator.normalizeCommand(cmd);
    const match = evaluator.evaluateCommandAgainstQuestions(normalized, exitCode, questions.filter((q) => !solved.has(q.id)));
    const at = new Date(startedAt.getTime() + (i + 1) * SECONDS_BETWEEN_COMMANDS * 1000).toISOString();
    const log = await db.run(
      `INSERT INTO command_logs (participant_id, question_id, raw_command, normalized_command, exit_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [participant.id, match ? match.question.id : null, cmd, normalized, exitCode, at]
    );
    if (!match) continue;
    solved.add(match.question.id);
    await Submission.markAutoResult(participant.id, match.question.id, {
      auto_result: 'pass', auto_score: match.question.point, matched_command_log_id: log.id });
  }
  for (const q of questions.filter((x) => x.check_type !== 'command_match' && !solved.has(x.id))) {
    const passed = student.state.includes(q.order_index);
    await Submission.markAutoResult(participant.id, q.id, { auto_result: passed ? 'pass' : 'fail', auto_score: passed ? q.point : 0 });
  }
}

async function seedSession(def) {
  const session = await Session.create({ name: def.name, duration_minutes: DURATION_MINUTES, ucp: 1 });
  const startedAt = new Date(def.startedAt);
  await db.run("UPDATE sessions SET status = 'ended', started_at = $1 WHERE id = $2", [startedAt.toISOString(), session.id]);
  for (const s of students.filter((x) => x.kelas === def.kelas)) {
    const user = await User.findOrCreateStudent(s.nim, s.name, s.kelas);
    const variant = Number(s.nim.slice(-1));
    const p = await Session.addParticipant(session.id, user.id, variant);
    await Session.updateParticipant(p.id, { container_status: 'ended', started_at: startedAt.toISOString() });
    const questions = await Question.listForVariantIndex(variant, 1);
    await gradeCommands(p, questions, s, startedAt);
  }
  return session;
}

(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:review-demo is dev-only (NODE_ENV=production)');
  await migrate();
  await db.run('DELETE FROM sessions WHERE name LIKE $1', [`${DEMO_PREFIX}%`]); // cascades participants/logs/submissions
  for (const q of bank) await Question.create(q);
  console.log(`[seed:review-demo] ${bank.length} demo questions upserted (UCP 1, variants 0-1)`);
  for (const def of sessions) {
    const s = await seedSession(def);
    console.log(`[seed:review-demo] session #${s.id} "${def.name}" seeded`);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

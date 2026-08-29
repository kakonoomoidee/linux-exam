const db = require('../db/connection');

const CommandLog = {
  create({ participant_id, question_id, raw_command, normalized_command, exit_code }) {
    return db.run(
      `INSERT INTO command_logs (participant_id, question_id, raw_command, normalized_command, exit_code)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [participant_id, question_id, raw_command, normalized_command, exit_code]
    );
  },

  listForParticipantQuestion(participantId, questionId) {
    return db.all(
      `SELECT * FROM command_logs
       WHERE participant_id = $1 AND question_id = $2
       ORDER BY created_at ASC, id ASC`,
      [participantId, questionId]
    );
  },

  listForParticipant(participantId) {
    return db.all(
      `SELECT * FROM command_logs WHERE participant_id = $1 ORDER BY created_at ASC, id ASC`,
      [participantId]
    );
  },

  /**
   * Every command from every participant in a session, time-ordered and
   * interleaved, annotated with which question it was attributed to and
   * whether it's the command that actually scored that question. Powers the
   * admin "session transcript" view.
   */
  listForSession(sessionId) {
    return db.all(
      `SELECT cl.id, cl.raw_command, cl.exit_code, cl.created_at,
              cl.question_id, q.order_index AS question_order,
              cl.participant_id, u.nim, u.name, u.kelas,
              (sub.matched_command_log_id = cl.id) AS is_match
       FROM command_logs cl
       JOIN session_participants sp ON sp.id = cl.participant_id
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN questions q ON q.id = cl.question_id
       LEFT JOIN submissions sub
         ON sub.participant_id = cl.participant_id AND sub.question_id = cl.question_id
       WHERE sp.session_id = $1
       ORDER BY cl.created_at ASC, cl.id ASC`,
      [sessionId]
    );
  },
};

const Submission = {
  async ensure(participantId, questionId) {
    await db.run(
      `INSERT INTO submissions (participant_id, question_id) VALUES ($1, $2)
       ON CONFLICT (participant_id, question_id) DO NOTHING`,
      [participantId, questionId]
    );
    return Submission.get(participantId, questionId);
  },

  get(participantId, questionId) {
    return db.get(
      `SELECT * FROM submissions WHERE participant_id = $1 AND question_id = $2`,
      [participantId, questionId]
    );
  },

  async markAutoResult(participantId, questionId, { auto_result, auto_score, matched_command_log_id }) {
    await Submission.ensure(participantId, questionId);
    await db.run(
      `UPDATE submissions
       SET auto_result = $1, auto_score = $2, matched_command_log_id = $3
       WHERE participant_id = $4 AND question_id = $5`,
      [auto_result, auto_score, matched_command_log_id || null, participantId, questionId]
    );
    return Submission.get(participantId, questionId);
  },

  async overrideScore(participantId, questionId, finalScore, reviewerUserId) {
    await Submission.ensure(participantId, questionId);
    await db.run(
      `UPDATE submissions
       SET final_score = $1, reviewed_by = $2, reviewed_at = now()
       WHERE participant_id = $3 AND question_id = $4`,
      [finalScore, reviewerUserId, participantId, questionId]
    );
    return Submission.get(participantId, questionId);
  },

  listForParticipant(participantId) {
    return db.all(
      `SELECT s.*, q.order_index, q.story_text, q.story_text_en, q.point, q.level
       FROM submissions s
       JOIN questions q ON q.id = s.question_id
       WHERE s.participant_id = $1
       ORDER BY q.order_index`,
      [participantId]
    );
  },

  listForSessionQuestion(sessionId, questionId) {
    return db.all(
      `SELECT s.*, sp.id as participant_id, u.nim, u.name, u.kelas
       FROM submissions s
       JOIN session_participants sp ON sp.id = s.participant_id
       JOIN users u ON u.id = sp.user_id
       WHERE sp.session_id = $1 AND s.question_id = $2
       ORDER BY u.nim`,
      [sessionId, questionId]
    );
  },

  /**
   * "Per Kelas" review: every question served to the students of one kelas in a
   * session (their variant × the session's UCP), LEFT-joined to each student's
   * submission so a no-show still shows up with a null result. Ordered so the
   * caller can chunk it straight into variant -> question -> students.
   */
  listForSessionKelas(sessionId, kelas) {
    return db.all(
      `SELECT sp.id AS participant_id, sp.variant_index,
              u.nim, u.name, u.kelas,
              q.id AS question_id, q.order_index, q.story_text, q.story_text_en,
              q.point, q.check_type, q.accepted_patterns, q.state_checker_script, q.ucp,
              s.auto_result, s.auto_score, s.final_score, s.matched_command_log_id
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       JOIN sessions se ON se.id = sp.session_id
       JOIN question_variants qv ON qv.variant_index = sp.variant_index
       JOIN questions q ON q.variant_id = qv.id AND q.ucp = se.ucp
       LEFT JOIN submissions s ON s.participant_id = sp.id AND s.question_id = q.id
       WHERE sp.session_id = $1 AND u.kelas = $2
       ORDER BY sp.variant_index, q.order_index, u.nim`,
      [sessionId, kelas]
    );
  },
};

module.exports = { CommandLog, Submission };

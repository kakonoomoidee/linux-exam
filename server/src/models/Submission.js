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

  /** Bare command rows for a whole session (review v2 near-miss analysis). */
  listRawForSession(sessionId) {
    return db.all(
      `SELECT cl.id, cl.participant_id, cl.question_id, cl.raw_command, cl.normalized_command,
              cl.exit_code, cl.created_at
       FROM command_logs cl
       JOIN session_participants sp ON sp.id = cl.participant_id
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

  /**
   * Review v2 correction: score + note + who/when in one write. The caller has
   * already validated the percent and that the question belongs to the
   * participant's variant.
   */
  async saveReview(participantId, questionId, { finalScore, note, reviewerId }) {
    await Submission.ensure(participantId, questionId);
    await db.run(
      `UPDATE submissions
       SET final_score = $1, review_note = $2, reviewed_by = $3, reviewed_at = now()
       WHERE participant_id = $4 AND question_id = $5`,
      [finalScore, note || null, reviewerId, participantId, questionId]
    );
    return Submission.get(participantId, questionId);
  },

  /** Undo a correction: the auto-grade counts again. */
  async clearReview(participantId, questionId) {
    await db.run(
      `UPDATE submissions
       SET final_score = NULL, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL
       WHERE participant_id = $1 AND question_id = $2`,
      [participantId, questionId]
    );
    return Submission.get(participantId, questionId);
  },

  /** Every submission in a session, with the reviewer's display name. */
  listForSession(sessionId) {
    return db.all(
      `SELECT s.id, s.participant_id, s.question_id, s.auto_result, s.auto_score, s.final_score,
              s.matched_command_log_id, s.reviewed_by, s.reviewed_at, s.review_note,
              COALESCE(ru.name, ru.nim) AS reviewer_name
       FROM submissions s
       JOIN session_participants sp ON sp.id = s.participant_id
       LEFT JOIN users ru ON ru.id = s.reviewed_by
       WHERE sp.session_id = $1`,
      [sessionId]
    );
  },

  listForParticipant(participantId) {
    return db.all(
      `SELECT s.*, q.order_index, q.story_text, q.story_text_en, q.point, q.level,
              q.check_type, q.accepted_patterns
       FROM submissions s
       JOIN questions q ON q.id = s.question_id
       WHERE s.participant_id = $1
       ORDER BY q.order_index`,
      [participantId]
    );
  },

};

module.exports = { CommandLog, Submission };

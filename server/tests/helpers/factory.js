/**
 * Row factories with sensible defaults so each test only spells out what it
 * actually cares about. Everything returns the created DB row; user factories
 * also attach a signed `token`.
 */
const crypto = require('node:crypto');
const db = require('../../src/db/connection');
const { hash } = require('../../src/lib/password');
const { signToken } = require('../../src/middleware/auth');

async function createAdmin({ nim = 'admin', password = 'admin123', name = 'Administrator', role = 'instruktur' } = {}) {
  const password_hash = await hash(password);
  const row = await db.run(
    `INSERT INTO users (nim, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
    [nim, name, role, password_hash]
  );
  return { ...row, password, token: signToken(row) };
}

/** Staff account with the asisten (TA) role — full session/grade access, no question bank. */
function createAsisten(opts = {}) {
  return createAdmin({ nim: 'asisten', name: 'Asisten', ...opts, role: 'asisten' });
}

/**
 * Default is an already-onboarded student: NULL password_hash, must_change_password = false,
 * so the signed token passes the /api/me/* password-change guard (keeps existing tests green).
 * Pass `password` to store a real hash, and `must_change_password: true` to exercise the
 * forced-change flow.
 */
async function createStudent({
  nim = '20220140055',
  name = 'Budi Santoso',
  kelas = null,
  password = null,
  must_change_password = false,
} = {}) {
  const password_hash = password == null ? null : await hash(password);
  const row = await db.run(
    `INSERT INTO users (nim, name, role, kelas, password_hash, must_change_password)
     VALUES ($1, $2, 'student', $3, $4, $5) RETURNING *`,
    [nim, name, kelas, password_hash, must_change_password]
  );
  return { ...row, password, token: signToken(row) };
}

async function createSession({ name = 'Test Session', duration_minutes = 10, status = 'pending', started_at, ucp = 1 } = {}) {
  return db.run(
    `INSERT INTO sessions (name, duration_minutes, status, started_at, ucp)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, duration_minutes, status, started_at || null, ucp]
  );
}

async function createParticipant({
  session,
  user,
  variant_index = 5,
  container_status = 'active',
  container_id,
  session_token,
  started_at,
  ends_at,
  active_question_id = null,
  violation_count = 0,
  lock_code = null,
  locked_at = null,
} = {}) {
  const token = session_token || crypto.randomUUID();
  const endsAt = ends_at === undefined ? new Date(Date.now() + 10 * 60000).toISOString() : ends_at;
  return db.run(
    `INSERT INTO session_participants
       (session_id, user_id, variant_index, container_id, container_status, session_token,
        started_at, ends_at, active_question_id, violation_count, lock_code, locked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      session.id,
      user.id,
      variant_index,
      container_id === undefined ? `mock-container-${user.id}` : container_id,
      container_status,
      token,
      started_at || new Date().toISOString(),
      endsAt,
      active_question_id,
      violation_count,
      lock_code,
      locked_at,
    ]
  );
}

async function createQuestion({
  variant_index = 5,
  order_index = 1,
  story_text = 'Do a thing',
  story_text_en = null,
  point = 1,
  level = 'medium',
  check_type = 'command_match',
  accepted_patterns = ['^ls$'],
  state_checker_script = null,
  ucp = 1,
} = {}) {
  const Question = require('../../src/models/Question');
  return Question.create({
    variant_index,
    order_index,
    story_text,
    story_text_en,
    point,
    level,
    check_type,
    accepted_patterns,
    state_checker_script,
    ucp,
  });
}

/** One admin + one student + one pending session, the common starting point. */
async function scaffold() {
  const admin = await createAdmin();
  const student = await createStudent();
  const session = await createSession();
  return { admin, student, session };
}

module.exports = {
  createAdmin,
  createAsisten,
  createStudent,
  createSession,
  createParticipant,
  createQuestion,
  scaffold,
};

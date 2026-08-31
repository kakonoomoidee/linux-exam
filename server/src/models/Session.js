const db = require('../db/connection');
const joinCode = require('../lib/joinCode');

const Session = {
  async create({ name, duration_minutes, ucp }) {
    const row = await db.run(
      "INSERT INTO sessions (name, duration_minutes, status, ucp) VALUES ($1, $2, 'pending', $3) RETURNING *",
      [name, duration_minutes, Number(ucp) === 2 ? 2 : 1]
    );
    // Mint the join code up front so the instructor sees it the moment the
    // session exists. It's inert until "Mulai Ujian" flips status to 'running'
    // (POST /me/join matches join_code AND status = 'running' in one query).
    return Session.ensureJoinCode(row.id);
  },

  findById(id) {
    return db.get('SELECT * FROM sessions WHERE id = $1', [id]);
  },

  listAll() {
    return db.all('SELECT * FROM sessions ORDER BY created_at DESC');
  },

  listRunning() {
    return db.all("SELECT * FROM sessions WHERE status = 'running'");
  },

  markRunning(id) {
    return db.run(
      "UPDATE sessions SET status = 'running', started_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
  },

  markEnded(id) {
    return db.run("UPDATE sessions SET status = 'ended' WHERE id = $1 RETURNING *", [id]);
  },

  // Allocate the session's join code once, on first call (idempotent). Retries on the
  // partial-unique collision on sessions.join_code; the keyspace makes >1 retry unheard of.
  async ensureJoinCode(id) {
    const current = await Session.findById(id);
    if (!current) return undefined;
    if (current.join_code) return current;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const row = await db.run(
          'UPDATE sessions SET join_code = $1 WHERE id = $2 AND join_code IS NULL RETURNING *',
          [joinCode.generate(), id]
        );
        return row || Session.findById(id); // no row => a concurrent call already set it
      } catch (err) {
        if (/unique|duplicate/i.test(err.message)) continue;
        throw err;
      }
    }
    throw new Error(`could not allocate a unique join_code for session ${id}`);
  },

  // participants / command_logs / submissions all cascade (see schema.sql)
  remove(id) {
    return db.run('DELETE FROM sessions WHERE id = $1', [id]);
  },

  addParticipant(sessionId, userId, variantIndex) {
    return db.run(
      `INSERT INTO session_participants (session_id, user_id, variant_index)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, user_id) DO UPDATE SET variant_index = EXCLUDED.variant_index
       RETURNING *`,
      [sessionId, userId, variantIndex]
    );
  },

  listParticipants(sessionId) {
    return db.all(
      `SELECT sp.*, u.nim, u.name, u.kelas, s.ucp
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       JOIN sessions s ON s.id = sp.session_id
       WHERE sp.session_id = $1
       ORDER BY u.nim`,
      [sessionId]
    );
  },

  getParticipant(participantId) {
    return db.get(
      `SELECT sp.*, u.nim, u.name, u.kelas, s.ucp
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       JOIN sessions s ON s.id = sp.session_id
       WHERE sp.id = $1`,
      [participantId]
    );
  },

  findParticipantByToken(token) {
    return db.get(
      `SELECT sp.*, u.nim, u.name, u.kelas, s.ucp
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       JOIN sessions s ON s.id = sp.session_id
       WHERE sp.session_token = $1`,
      [token]
    );
  },

  // Anti-cheat lock: new unlock code on every violation (old code becomes
  // invalid), violation_count bumped atomically in the same statement.
  recordViolation(participantId, code) {
    return db.run(
      `UPDATE session_participants
       SET lock_code = $1, locked_at = now(), violation_count = violation_count + 1
       WHERE id = $2 RETURNING *`,
      [code, participantId]
    );
  },

  clearLock(participantId) {
    return db.run(
      'UPDATE session_participants SET lock_code = NULL, locked_at = NULL WHERE id = $1 RETURNING *',
      [participantId]
    );
  },

  async updateParticipant(participantId, fields) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return Session.getParticipant(participantId);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => fields[k]);
    await db.run(
      `UPDATE session_participants SET ${setClause} WHERE id = $${keys.length + 1}`,
      [...values, participantId]
    );
    return Session.getParticipant(participantId);
  },
};

module.exports = Session;

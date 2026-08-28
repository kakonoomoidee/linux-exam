const db = require('../db/connection');

const Session = {
  create({ name, duration_minutes }) {
    return db.run(
      "INSERT INTO sessions (name, duration_minutes, status) VALUES ($1, $2, 'pending') RETURNING *",
      [name, duration_minutes]
    );
  },

  findById(id) {
    return db.get('SELECT * FROM sessions WHERE id = $1', [id]);
  },

  listAll() {
    return db.all('SELECT * FROM sessions ORDER BY created_at DESC');
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
      `SELECT sp.*, u.nim, u.name
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.session_id = $1
       ORDER BY u.nim`,
      [sessionId]
    );
  },

  getParticipant(participantId) {
    return db.get(
      `SELECT sp.*, u.nim, u.name
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
       WHERE sp.id = $1`,
      [participantId]
    );
  },

  findParticipantByToken(token) {
    return db.get(
      `SELECT sp.*, u.nim, u.name
       FROM session_participants sp
       JOIN users u ON u.id = sp.user_id
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

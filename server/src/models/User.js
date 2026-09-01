const db = require('../db/connection');
const { hash } = require('../lib/password');

const STAFF_ROLES = ['instruktur', 'asisten'];

const User = {
  findByNim(nim) {
    return db.get('SELECT * FROM users WHERE nim = $1', [nim]);
  },

  findById(id) {
    return db.get('SELECT * FROM users WHERE id = $1', [id]);
  },

  /** The student a Telegram chat is bound to, or undefined. */
  findByTelegramChatId(chatId) {
    return db.get('SELECT * FROM users WHERE telegram_chat_id = $1', [String(chatId)]);
  },

  create({ nim, name, role = 'student', password_hash = null, kelas = null, telegram_username = null, telegram_chat_id = null }) {
    return db.run(
      `INSERT INTO users (nim, name, role, password_hash, kelas, telegram_username, telegram_chat_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [nim, name, role, password_hash, kelas, telegram_username, telegram_chat_id]
    );
  },

  async findOrCreateStudent(nim, name = null, kelas = null, telegram = null) {
    const tgUser = telegram && telegram.username ? String(telegram.username).trim() || null : null;
    const tgChat = telegram && telegram.chatId ? String(telegram.chatId).trim() || null : null;
    const existing = await User.findByNim(nim);
    if (existing) {
      // backfill name / kelas / telegram if we now have them and the row lacks them
      const sets = [];
      const vals = [];
      if (name && !existing.name) { sets.push(`name = $${sets.length + 1}`); vals.push(name); }
      if (kelas && !existing.kelas) { sets.push(`kelas = $${sets.length + 1}`); vals.push(kelas); }
      if (tgUser && !existing.telegram_username) { sets.push(`telegram_username = $${sets.length + 1}`); vals.push(tgUser); }
      if (tgChat && !existing.telegram_chat_id) { sets.push(`telegram_chat_id = $${sets.length + 1}`); vals.push(tgChat); }
      if (sets.length === 0) return existing;
      return db.run(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${sets.length + 1} RETURNING *`,
        [...vals, existing.id]
      );
    }
    // New student: default password IS their NIM, and must_change_password stays true
    // (schema default). Existing NULL-hash rows are left alone — the login path treats a
    // NULL hash as "password is the NIM, must change" on its own.
    return User.create({
      nim, name, role: 'student', kelas,
      password_hash: await hash(String(nim)),
      telegram_username: tgUser,
      telegram_chat_id: tgChat,
    });
  },

  listAll() {
    return db.all('SELECT id, nim, name, role, kelas FROM users ORDER BY nim');
  },

  /** Every student row, for the global roster view. Nulls-last on kelas, then NIM. */
  listStudents() {
    return db.all(
      `SELECT id, nim, name, kelas, telegram_username, telegram_chat_id
         FROM users WHERE role = 'student' ORDER BY kelas NULLS LAST, nim`
    );
  },

  /** Staff correction of a student's name / kelas / Telegram binding. Only the keys passed are touched. */
  async updateStudent(id, fields) {
    const allowed = ['name', 'kelas', 'telegram_username', 'telegram_chat_id'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (keys.length === 0) return User.findById(id);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map((k) => fields[k]);
    return db.run(
      `UPDATE users SET ${setClause} WHERE id = $${keys.length + 1} AND role = 'student' RETURNING *`,
      [...values, id]
    );
  },

  /** Instruktur + asisten accounts, for the admin "Staf" panel. */
  listStaff() {
    return db.all(
      "SELECT id, nim, name, role FROM users WHERE role IN ('instruktur', 'asisten') ORDER BY role, nim"
    );
  },

  async createStaff({ nim, name, password, role }) {
    if (!STAFF_ROLES.includes(role)) throw new Error('role harus instruktur atau asisten');
    if (!nim || !password) throw new Error('nim dan password wajib diisi');
    // Staff set their own password on creation — the student-only forced-change flag never applies.
    return db.run(
      `INSERT INTO users (nim, name, role, password_hash, must_change_password) VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (nim) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
                                       password_hash = EXCLUDED.password_hash,
                                       must_change_password = false
       RETURNING id, nim, name, role`,
      [nim, name || null, role, await hash(password)]
    );
  },

  /**
   * Set (or clear, with nulls) a student's Telegram binding. Returns the updated row.
   * Used by the bot on self-service /start, by staff via PATCH, and by self-unlink.
   */
  setTelegramBinding(id, { chatId = null, username = null } = {}) {
    return db.run(
      `UPDATE users SET telegram_chat_id = $1, telegram_username = $2
       WHERE id = $3 AND role = 'student' RETURNING *`,
      [chatId, username, id]
    );
  },

  /** Set a new password and clear the forced-change flag (student change-password flow). */
  setPassword(id, passwordHash) {
    return db.run(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 RETURNING *',
      [passwordHash, id]
    );
  },

  removeStaff(id) {
    return db.run("DELETE FROM users WHERE id = $1 AND role IN ('instruktur', 'asisten')", [id]);
  },

  countInstruktur() {
    return db.get("SELECT count(*)::int AS count FROM users WHERE role = 'instruktur'");
  },

  /** Last digit of NIM -> question variant index (0-9). Non-digit NIMs fall back to variant 0. */
  variantIndexForNim(nim) {
    const match = String(nim).match(/(\d)(?!.*\d)/); // last digit in the string
    return match ? parseInt(match[1], 10) : 0;
  },
};

module.exports = User;

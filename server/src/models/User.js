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

  create({ nim, name, role = 'student', password_hash = null, kelas = null }) {
    return db.run(
      'INSERT INTO users (nim, name, role, password_hash, kelas) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nim, name, role, password_hash, kelas]
    );
  },

  async findOrCreateStudent(nim, name = null, kelas = null) {
    const existing = await User.findByNim(nim);
    if (existing) {
      // backfill name / kelas if we now have them and the row was created without
      const sets = [];
      const vals = [];
      if (name && !existing.name) { sets.push(`name = $${sets.length + 1}`); vals.push(name); }
      if (kelas && !existing.kelas) { sets.push(`kelas = $${sets.length + 1}`); vals.push(kelas); }
      if (sets.length === 0) return existing;
      return db.run(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${sets.length + 1} RETURNING *`,
        [...vals, existing.id]
      );
    }
    // New student: default password IS their NIM, and must_change_password stays true
    // (schema default). Existing NULL-hash rows are left alone — the login path treats a
    // NULL hash as "password is the NIM, must change" on its own.
    return User.create({ nim, name, role: 'student', kelas, password_hash: await hash(String(nim)) });
  },

  listAll() {
    return db.all('SELECT id, nim, name, role, kelas FROM users ORDER BY nim');
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

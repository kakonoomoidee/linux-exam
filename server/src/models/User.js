const db = require('../db/connection');

const User = {
  findByNim(nim) {
    return db.get('SELECT * FROM users WHERE nim = $1', [nim]);
  },

  findById(id) {
    return db.get('SELECT * FROM users WHERE id = $1', [id]);
  },

  create({ nim, name, role = 'student', password_hash = null }) {
    return db.run(
      'INSERT INTO users (nim, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [nim, name, role, password_hash]
    );
  },

  async findOrCreateStudent(nim, name = null) {
    const existing = await User.findByNim(nim);
    if (existing) {
      // backfill a name if we now have one and the row was created name-less
      if (name && !existing.name) {
        return db.run('UPDATE users SET name = $1 WHERE id = $2 RETURNING *', [name, existing.id]);
      }
      return existing;
    }
    return User.create({ nim, name, role: 'student' });
  },

  listAll() {
    return db.all('SELECT id, nim, name, role FROM users ORDER BY nim');
  },

  /** Last digit of NIM -> question variant index (0-9). Non-digit NIMs fall back to variant 0. */
  variantIndexForNim(nim) {
    const match = String(nim).match(/(\d)(?!.*\d)/); // last digit in the string
    return match ? parseInt(match[1], 10) : 0;
  },
};

module.exports = User;

const bcrypt = require('bcryptjs');

// bcrypt, cost 12 — the standard for password-at-rest. Bump COST if hashing
// ever feels too cheap on prod hardware; existing hashes keep verifying.
const COST = 12;

const hash = (plain) => bcrypt.hash(plain, COST);
const verify = (plain, hash) => bcrypt.compare(plain || '', hash || '');

/**
 * Check a *student's* current password. A NULL password_hash is a legacy row that
 * predates student passwords — for those, the password is simply the NIM.
 */
async function checkStudentPassword(user, plain) {
  if (!user.password_hash) return plain != null && String(plain) === String(user.nim);
  return verify(plain, user.password_hash);
}

module.exports = { hash, verify, checkStudentPassword };

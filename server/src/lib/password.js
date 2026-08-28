const bcrypt = require('bcryptjs');

// bcrypt, cost 12 — the standard for password-at-rest. Bump COST if hashing
// ever feels too cheap on prod hardware; existing hashes keep verifying.
const COST = 12;

module.exports = {
  hash: (plain) => bcrypt.hash(plain, COST),
  verify: (plain, hash) => bcrypt.compare(plain, hash || ''),
};

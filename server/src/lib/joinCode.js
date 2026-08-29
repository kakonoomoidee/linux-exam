const crypto = require('node:crypto');

// Human-typable, read-aloud-friendly: no 0/O, no 1/I/L. 32 symbols, 6 chars => ~1e9 keyspace.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 6;

/** A fresh 6-char join code. Uniqueness is enforced by the caller against the DB. */
function generate() {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

module.exports = { generate, ALPHABET, LENGTH };

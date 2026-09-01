// Kelas is a single letter A–F. Two entry points:
//   normalizeKelas — strict, for live input (forms, PATCH, import rows).
//   salvageKelas   — lenient, for the one-time migration of legacy free-text.

const RE = /^[A-F]$/;

// '' / 'a' / ' B ' -> 'A'.. / null.  Anything that isn't already a single A–F letter -> null.
function normalizeKelas(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return RE.test(v) ? v : null;
}

// 'TI-3A' -> 'A', 'kelas b' -> 'B', 'X9' / '' -> null.  Takes the last alphabetic char.
function salvageKelas(raw) {
  const letters = String(raw ?? '').toUpperCase().match(/[A-Z]/g);
  const last = letters && letters[letters.length - 1];
  return last && RE.test(last) ? last : null;
}

module.exports = { normalizeKelas, salvageKelas };

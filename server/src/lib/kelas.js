// Kelas is a single letter A–F. Two entry points:
//   normalizeKelas — strict, for live input (forms, PATCH, import rows).
//   salvageKelas   — lenient, for the one-time migration of legacy free-text.

const RE = /^[A-F]$/;
// ponytail: staff can add ad-hoc class codes from the edit form (see
// ALLOW_CUSTOM_KELAS in students.js). Sort/group elsewhere keys on the first
// char and degrades fine. Tighten back to RE if the A–F lab sections are fixed.
const RE_LOOSE = /^[A-Z0-9-]{1,12}$/;

// '' / 'a' / ' b1 ' -> 'A' / 'B1' / null.  Anything not a short class code -> null.
function normalizeKelas(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return RE_LOOSE.test(v) ? v : null;
}

// 'TI-3A' -> 'A', 'kelas b' -> 'B', 'X9' / '' -> null.  Takes the last alphabetic char.
function salvageKelas(raw) {
  const letters = String(raw ?? '').toUpperCase().match(/[A-Z]/g);
  const last = letters && letters[letters.length - 1];
  return last && RE.test(last) ? last : null;
}

module.exports = { normalizeKelas, salvageKelas };

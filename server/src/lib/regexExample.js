/**
 * Turns an accepted_patterns regex source into one short, human-readable
 * command that the regex accepts (e.g. `^head\s+-n?\s?5\s+log\.txt$` ->
 * `head -n 5 log.txt`). Used to show a readable answer key when the
 * instruktur hasn't written sample answers yet.
 *
 * This is a best-effort generator for the small regex subset question banks
 * actually use (literals, escapes, classes, groups, alternation, ?*+{n}).
 * It returns null for anything it doesn't understand (lookarounds,
 * backreferences). Callers MUST verify the result with the real grader
 * (answerKeyService does) — a wrong guess is dropped, never shown.
 */

const PLACEHOLDER_WORD = 'file'; // stands in for \S+ / \w+ (a filename-ish token)
const PLACEHOLDER_CHAR = 'x';
const ESCAPE_TEXT = { s: ' ', t: ' ', d: '1', D: 'x', W: '-', b: '', S: PLACEHOLDER_WORD, w: PLACEHOLDER_WORD };
const WORDY_ESCAPES = new Set(['S', 'w']);
const UNSUPPORTED_ESCAPES = new Set(['B', 'n', 'r', 'k', 'p', 'P']);
// An optional single character is included when it makes the example read
// naturally (`-n?` -> `-n`, `\s?` -> ` `); slashes, quotes, braces are skipped.
const isNaturalOptional = (ch) => /^[a-z0-9 -]$/i.test(ch);

class Unsupported extends Error {}

function readEscape(src, i) {
  const c = src[i + 1];
  if (c === undefined) throw new Unsupported('dangling escape');
  if (c === 'x') return { text: String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)), len: 4 };
  if (c === 'u') return { text: String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)), len: 6 };
  if (/[1-9]/.test(c) || UNSUPPORTED_ESCAPES.has(c)) throw new Unsupported(`escape \\${c}`);
  if (c in ESCAPE_TEXT) return { text: ESCAPE_TEXT[c], len: 2, wordy: WORDY_ESCAPES.has(c) };
  return { text: c, len: 2 };
}

/** Picks one representative character from a [...] class body. */
function readClass(src, start) {
  let i = start + 1;
  const negated = src[i] === '^';
  if (negated) i++;
  const chars = [];
  while (i < src.length && (src[i] !== ']' || i === start + 1)) {
    if (src[i] === '\\') {
      const esc = readEscape(src, i);
      chars.push(esc.wordy ? PLACEHOLDER_CHAR : esc.text);
      i += esc.len;
    } else {
      chars.push(src[i]);
      i += src[i + 1] === '-' && src[i + 2] && src[i + 2] !== ']' ? 3 : 1; // range a-z -> a
    }
  }
  if (src[i] !== ']') throw new Unsupported('unterminated class');
  if (negated) return { text: ['x', 'a', '1'].find((ch) => !chars.includes(ch)) || '_', end: i + 1 };
  const preferred = chars.find((ch) => /[a-z0-9-]/i.test(ch)) ?? chars[0] ?? '';
  return { text: preferred, end: i + 1 };
}

function readQuantifier(src, i) {
  const c = src[i];
  let q = null;
  let len = 0;
  if (c === '?' || c === '*' || c === '+') {
    q = { min: c === '+' ? 1 : 0, kind: c };
    len = 1;
  } else if (c === '{') {
    const m = /^\{(\d+)(,\d*)?\}/.exec(src.slice(i));
    if (m) {
      q = { min: Number(m[1]), kind: '{' };
      len = m[0].length;
    }
  }
  if (q && src[i + len] === '?') len++; // lazy modifier: irrelevant for generation
  return { q, len };
}

function repeatAtom(atom, q) {
  if (!q) return atom.text;
  if (q.kind === '?') return atom.single && isNaturalOptional(atom.text) ? atom.text : '';
  if (q.kind === '*') return atom.text === ' ' ? ' ' : '';
  if (q.kind === '+') return atom.text;
  return atom.wordy ? atom.text : atom.text.repeat(q.min);
}

/** Parses one alternative list until ')' or end; returns the first alternative's text. */
function parseAlternation(src, start) {
  const alternatives = [];
  let current = '';
  let i = start;
  while (i < src.length && src[i] !== ')') {
    if (src[i] === '|') {
      alternatives.push(current);
      current = '';
      i++;
      continue;
    }
    const { atom, end } = parseAtom(src, i);
    const { q, len } = readQuantifier(src, end);
    current += repeatAtom(atom, q);
    i = end + len;
  }
  alternatives.push(current);
  return { text: alternatives[0], end: i };
}

function parseAtom(src, i) {
  const c = src[i];
  if (c === '^' || c === '$') return { atom: { text: '' }, end: i + 1 };
  if (c === '\\') {
    const esc = readEscape(src, i);
    return { atom: { text: esc.text, single: esc.text.length === 1, wordy: esc.wordy }, end: i + esc.len };
  }
  if (c === '[') {
    const cls = readClass(src, i);
    return { atom: { text: cls.text, single: false }, end: cls.end };
  }
  if (c === '(') {
    let body = i + 1;
    if (src[body] === '?') {
      if (src[body + 1] !== ':') throw new Unsupported('lookaround / named group');
      body += 2;
    }
    const group = parseAlternation(src, body);
    if (src[group.end] !== ')') throw new Unsupported('unbalanced group');
    return { atom: { text: group.text, single: false }, end: group.end + 1 };
  }
  if (c === '.') return { atom: { text: PLACEHOLDER_CHAR, single: false }, end: i + 1 };
  return { atom: { text: c, single: true }, end: i + 1 };
}

/**
 * @param {string} patternSrc regex source as stored in accepted_patterns
 * @returns {string|null} a candidate example (unverified), or null if unsupported
 */
function exampleFromPattern(patternSrc) {
  if (typeof patternSrc !== 'string' || !patternSrc) return null;
  try {
    const { text, end } = parseAlternation(patternSrc, 0);
    if (end !== patternSrc.length) return null; // stray ')'
    return text.replace(/ {2,}/g, ' ').trim() || null;
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}

module.exports = { exampleFromPattern };

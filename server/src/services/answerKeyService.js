/**
 * Readable answer key for a question: which example commands satisfy which
 * accepted pattern, plus a plain-language reading of a state_checker script.
 *
 * Every "does this command match" decision goes through the grader
 * (evaluatorService.normalizeCommand + matchesAnyPattern) so the key can never
 * disagree with how students were actually scored.
 */
const { normalizeCommand, matchesAnyPattern } = require('./evaluatorService');
const { exampleFromPattern } = require('../lib/regexExample');

const MAX_EXAMPLES_PER_PATTERN = 3;
const MAX_EXAMPLE_LENGTH = 300;
const CHECK_TYPE = Object.freeze({ COMMAND: 'command_match', STATE: 'state_check', BOTH: 'both' });

/** accepted_patterns / sample_answers come off the DB as JSON text; accept arrays too. */
function parseList(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** True when the grader would accept `command` for this one pattern. */
function exampleMatchesPattern(command, pattern) {
  return matchesAnyPattern(normalizeCommand(command), [pattern]) !== null;
}

/**
 * A pattern that only matches text the grader always strips (quotes, `./`)
 * can never award points: its natural example passes the raw regex but fails
 * once normalized. Returns that example, or null.
 */
function normalizationConflict(pattern) {
  const example = exampleFromPattern(pattern);
  if (!example || exampleMatchesPattern(example, pattern)) return null;
  try {
    return new RegExp(pattern, 'i').test(example) ? example : null;
  } catch {
    return null;
  }
}

/** Verified auto-generated example for a pattern, or null. */
function derivedExample(pattern) {
  const example = exampleFromPattern(pattern);
  return example && exampleMatchesPattern(example, pattern) ? example : null;
}

/**
 * @returns {{ patterns: Array<{pattern, examples: string[], derived: boolean, conflictExample: string|null}>,
 *            unmatchedExamples: string[], stateChecks: Array<{check, target, value?}>, examples: string[] }}
 *   `examples` is the flat list of every usable example (stored + derived) for similarity checks.
 */
function buildAnswerKey(question) {
  const patterns = parseList(question.accepted_patterns);
  const stored = parseList(question.sample_answers);
  const assigned = new Set();

  const patternRows = patterns.map((pattern) => {
    const mine = stored.filter((ex) => exampleMatchesPattern(ex, pattern));
    mine.forEach((ex) => assigned.add(ex));
    const fallback = mine.length ? null : derivedExample(pattern);
    return {
      pattern,
      examples: mine.length ? mine.slice(0, MAX_EXAMPLES_PER_PATTERN) : fallback ? [fallback] : [],
      derived: !mine.length && Boolean(fallback),
      conflictExample: normalizationConflict(pattern),
    };
  });

  // state_check questions have no patterns: stored examples are free-form
  const unmatchedExamples = stored.filter((ex) => !assigned.has(ex));
  const examples = [...new Set([...patternRows.flatMap((p) => p.examples), ...(patterns.length ? [] : unmatchedExamples)])];
  return {
    patterns: patternRows,
    unmatchedExamples: patterns.length ? unmatchedExamples : [],
    stateChecks: explainStateChecker(question.state_checker_script),
    examples,
  };
}

const STATE_RULES = [
  { re: /(?:test|\[)\s+-d\s+(\S+)/g, check: 'dir_exists' },
  { re: /(?:test|\[)\s+-f\s+(\S+)/g, check: 'file_exists' },
  { re: /(?:test|\[)\s+-e\s+(\S+)/g, check: 'path_exists' },
  { re: /(?:test|\[)\s+!\s+-[efd]\s+(\S+)/g, check: 'path_absent' },
  { re: /!\s+(?:test|\[)\s+-[efd]\s+(\S+)/g, check: 'path_absent' },
  { re: /stat\s+-c\s+%a\s+(\S+?)(?:\s|\)|$)[\s\S]*?=\s*["']?(\d{3,4})/g, check: 'permission' },
];

/**
 * Plain-language reading of common state_checker idioms (test -d / -f / ! -e,
 * stat -c %a). Returns structured items; the UI turns them into ID/EN text.
 * Unknown scripts return [] and the UI just shows the script.
 */
function explainStateChecker(script) {
  if (!script) return [];
  const items = [];
  for (const rule of STATE_RULES) {
    for (const m of script.matchAll(rule.re)) {
      const item = { check: rule.check, target: m[1].replace(/["')\]]+$/, '') };
      if (m[2]) item.value = m[2];
      items.push(item);
    }
  }
  return items;
}

/**
 * Validates an instruktur's sample answers for a question. For pattern-based
 * questions each answer must be accepted by the grader and no pattern may get
 * more than MAX_EXAMPLES_PER_PATTERN. state_check-only questions accept any
 * command (there is no regex to check against).
 * @returns {{ answers: string[], errors: Array<{answer: string, error: string}> }}
 */
function validateSampleAnswers(question, rawAnswers) {
  if (!Array.isArray(rawAnswers)) return { answers: [], errors: [{ answer: '', error: 'not_array' }] };
  const answers = [...new Set(rawAnswers.map((a) => String(a ?? '').trim()).filter(Boolean))];
  const patterns = parseList(question.accepted_patterns);
  const perPattern = new Map();
  const errors = [];

  for (const answer of answers) {
    if (answer.length > MAX_EXAMPLE_LENGTH) {
      errors.push({ answer, error: 'too_long' });
      continue;
    }
    if (question.check_type === CHECK_TYPE.STATE && !patterns.length) continue;
    const pattern = patterns.find((p) => exampleMatchesPattern(answer, p));
    if (!pattern) {
      errors.push({ answer, error: 'no_pattern_match' });
      continue;
    }
    perPattern.set(pattern, (perPattern.get(pattern) || 0) + 1);
    if (perPattern.get(pattern) > MAX_EXAMPLES_PER_PATTERN) errors.push({ answer, error: 'too_many_for_pattern' });
  }
  return { answers, errors };
}

module.exports = {
  CHECK_TYPE,
  MAX_EXAMPLES_PER_PATTERN,
  parseList,
  exampleMatchesPattern,
  normalizationConflict,
  derivedExample,
  buildAnswerKey,
  explainStateChecker,
  validateSampleAnswers,
};

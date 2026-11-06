/**
 * "Hampir benar" detection. For a question the auto-grader did NOT pass, look
 * through the participant's command history and decide:
 *   correct_in_history - a command already matches an accepted pattern (exit 0)
 *                        but it wasn't the one that got scored
 *   near_miss          - close: spacing / slash / quotes / ~ path / flag style /
 *                        small typo / functional equivalent / failed exit code
 *   wrong              - nothing close
 * The result is only a suggestion (label + reasons + suggested percent); it
 * never changes a score. All pattern matching goes through evaluatorService.
 */
const { normalizeCommand, matchesAnyPattern } = require('./evaluatorService');
const { buildAnswerKey, parseList, CHECK_TYPE } = require('./answerKeyService');
const { REASON, commandVariants, canonicalCommand } = require('../lib/commandVariants');
const { editDistance } = require('../lib/editDistance');

const LABEL = Object.freeze({
  CORRECT: 'correct',
  IN_HISTORY: 'correct_in_history',
  NEAR_MISS: 'near_miss',
  WRONG: 'wrong',
});

const EXTRA_REASON = Object.freeze({
  IN_HISTORY: 'in_history',
  QUOTES: 'quotes', // raw command matches; normalization (quote / ./ stripping) broke it
  COSMETIC: 'cosmetic', // same as an example answer apart from case/space/slash/flag order
  TYPO: 'typo',
  FAILED_EXIT: 'failed_exit',
  STATE_FAILED: 'state_failed',
  SPLIT_COMMANDS: 'split_commands', // right answer typed as two consecutive commands
  STATE_TARGET: 'state_target', // touched the path the state_checker inspects, but the final state failed
  NO_COMMANDS: 'no_commands',
  NO_CLOSE_COMMAND: 'no_close_command',
});

// Suggested credit per reason; a candidate with several reasons gets the minimum.
const SUGGESTED_PERCENT = Object.freeze({
  [EXTRA_REASON.IN_HISTORY]: 100,
  [EXTRA_REASON.QUOTES]: 100,
  [EXTRA_REASON.COSMETIC]: 100,
  [REASON.SPACING]: 100,
  [REASON.TRAILING_SLASH]: 100,
  [REASON.FLAG_STYLE]: 100,
  [REASON.HOME_PATH]: 75,
  [REASON.EQUIVALENT]: 75,
  [EXTRA_REASON.STATE_FAILED]: 75,
  [EXTRA_REASON.SPLIT_COMMANDS]: 75,
  [EXTRA_REASON.TYPO]: 50,
  [EXTRA_REASON.STATE_TARGET]: 50,
  [EXTRA_REASON.FAILED_EXIT]: 50,
});

const MIN_TYPO_LENGTH = 4; // shorter commands (ls, cd, pwd) are too ambiguous to call typos
const TYPO_STEPS = [
  { maxLength: 8, maxDistance: 1 },
  { maxLength: 20, maxDistance: 2 },
  { maxLength: Infinity, maxDistance: 3 },
];

function maxTypoDistance(length) {
  if (length < MIN_TYPO_LENGTH) return 0;
  return TYPO_STEPS.find((s) => length <= s.maxLength).maxDistance;
}

const percentFor = (reasons) => Math.min(...reasons.map((r) => SUGGESTED_PERCENT[r] ?? 0));
const firstWord = (cmd) => String(cmd || '').split(' ')[0].toLowerCase();

function normalizedOf(log) {
  return log.normalized_command || normalizeCommand(log.raw_command);
}

/** Closest example-based reason for one command, or null. */
function exampleReason(normalized, examples) {
  const canon = canonicalCommand(normalized);
  let typo = false;
  for (const example of examples) {
    const exCanon = canonicalCommand(example);
    if (canon === exCanon) return EXTRA_REASON.COSMETIC;
    const limit = maxTypoDistance(Math.min(canon.length, exCanon.length));
    if (limit && editDistance(canon, exCanon) <= limit) typo = true;
  }
  return typo ? EXTRA_REASON.TYPO : null;
}

/** Best near-miss reasons for one command against the question's patterns/examples, or null. */
function patternReasons(log, patterns) {
  if (!patterns.length) return null;
  const normalized = normalizedOf(log);
  if (matchesAnyPattern(normalized, patterns)) return [EXTRA_REASON.IN_HISTORY];
  const raw = String(log.raw_command || '').trim().replace(/\s+/g, ' ');
  if (matchesAnyPattern(raw, patterns)) return [EXTRA_REASON.QUOTES];
  let best = null;
  for (const variant of commandVariants(normalized)) {
    if (!matchesAnyPattern(variant.command, patterns)) continue;
    if (!best || percentFor(variant.reasons) > percentFor(best)) best = variant.reasons;
  }
  return best;
}

/** Last path segment of each state_checker target (`~/Desktop/UCP1` -> `ucp1`). */
function stateTargetNames(stateChecks) {
  return stateChecks.map((c) => c.target.replace(/\/+$/, '').split('/').pop().toLowerCase()).filter((n) => n.length > 1);
}

function mentionsStateTarget(log, targetNames) {
  if (log.exit_code !== 0 || !targetNames.length) return false;
  const words = normalizedOf(log).toLowerCase().split(/[\s/]+/);
  return targetNames.some((name) => words.includes(name));
}

/** Scores one history entry. @returns {{log, reasons, percent}|null} */
function evaluateLog(log, { patterns, examples, isStateOnly, targetNames }) {
  let reasons = patternReasons(log, patterns);
  if (!reasons && examples.length) {
    const r = exampleReason(normalizedOf(log), examples);
    if (r) reasons = [r];
  }
  if (!reasons && isStateOnly && mentionsStateTarget(log, targetNames)) reasons = [EXTRA_REASON.STATE_TARGET];
  if (!reasons) return null;
  if (log.exit_code !== 0) reasons = [...reasons.filter((r) => r !== EXTRA_REASON.IN_HISTORY), EXTRA_REASON.FAILED_EXIT];
  if (isStateOnly) reasons = [...reasons, EXTRA_REASON.STATE_FAILED];
  return { log, reasons, percent: percentFor(reasons) };
}

/** Higher percent wins, then exit 0, then the later command. */
function isBetter(a, b) {
  if (!b) return true;
  if (a.percent !== b.percent) return a.percent > b.percent;
  if ((a.log.exit_code === 0) !== (b.log.exit_code === 0)) return a.log.exit_code === 0;
  return a.log.id > b.log.id;
}

/**
 * Two consecutive successful commands joined with ` ; ` (e.g. `x=1` then
 * `echo $x` for "in one line"). Only pattern matches count — joining two
 * unrelated commands must not look like a typo of an example.
 */
function scoreSplitPairs(pool, patterns) {
  const out = [];
  for (let i = 1; i < pool.length; i++) {
    const [a, b] = [pool[i - 1], pool[i]];
    if (a.exit_code !== 0 || b.exit_code !== 0) continue;
    const joined = { id: b.id, exit_code: 0, normalized_command: `${normalizedOf(a)} ; ${normalizedOf(b)}`,
      raw_command: `${a.raw_command}; ${b.raw_command}` };
    const reasons = patternReasons(joined, patterns);
    if (!reasons) continue;
    const merged = [EXTRA_REASON.SPLIT_COMMANDS, ...reasons.filter((r) => r !== EXTRA_REASON.IN_HISTORY)];
    out.push({ log: joined, pairIds: [a.id, b.id], reasons: merged, percent: percentFor(merged) });
  }
  return out;
}

function relevantIds({ question, pool, scored, examples, matchedIds }) {
  const words = new Set(examples.map(firstWord));
  const ids = new Set(matchedIds);
  for (const s of scored) (s.pairIds || [s.log.id]).forEach((id) => ids.add(id));
  for (const log of pool) {
    if (log.question_id === question.id || words.has(firstWord(normalizedOf(log)))) ids.add(log.id);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * @param {object} args
 * @param {object} args.question     questions row (accepted_patterns / sample_answers as JSON text)
 * @param {object} [args.submission] submissions row, if any
 * @param {object[]} args.commands   the participant's whole command log, time-ordered
 * @param {Set<number>} [args.foreignMatchIds] log ids that scored a DIFFERENT question
 * @returns {{label, reasons: string[], suggestedPercent, candidateLogId, candidateCommand,
 *            gradedLogId, matchedLogIds: number[], relevantLogIds: number[]}}
 */
function classifyAnswer({ question, submission, commands, foreignMatchIds = new Set() }) {
  const gradedLogId = submission?.matched_command_log_id ?? null;
  const patterns = parseList(question.accepted_patterns);
  const { examples, stateChecks } = buildAnswerKey(question);
  const pool = commands.filter((c) => !foreignMatchIds.has(c.id));
  const matchedLogIds = pool.filter((c) => patterns.length && matchesAnyPattern(normalizedOf(c), patterns)).map((c) => c.id);
  const base = { gradedLogId, matchedLogIds, candidateLogId: null, candidateCommand: null };

  if (submission?.auto_result === 'pass') {
    return { ...base, label: LABEL.CORRECT, reasons: [], suggestedPercent: 100, candidateLogId: gradedLogId,
      relevantLogIds: relevantIds({ question, pool, scored: [], examples, matchedIds: [gradedLogId, ...matchedLogIds].filter(Boolean) }) };
  }

  const isStateOnly = question.check_type === CHECK_TYPE.STATE;
  const targetNames = isStateOnly ? stateTargetNames(stateChecks) : [];
  const ctx = { patterns, examples, isStateOnly, targetNames };
  const scored = [...pool.map((log) => evaluateLog(log, ctx)).filter(Boolean), ...scoreSplitPairs(pool, patterns)];
  const best = scored.reduce((acc, s) => (isBetter(s, acc) ? s : acc), null);
  const relevantLogIds = relevantIds({ question, pool, scored, examples, matchedIds: matchedLogIds });

  if (!best) {
    const reason = pool.length ? EXTRA_REASON.NO_CLOSE_COMMAND : EXTRA_REASON.NO_COMMANDS;
    return { ...base, label: LABEL.WRONG, reasons: [reason], suggestedPercent: 0, relevantLogIds };
  }
  const label = best.reasons.length === 1 && best.reasons[0] === EXTRA_REASON.IN_HISTORY ? LABEL.IN_HISTORY : LABEL.NEAR_MISS;
  return {
    ...base,
    label,
    reasons: best.reasons,
    suggestedPercent: best.percent,
    candidateLogId: best.log.id,
    candidateCommand: normalizedOf(best.log),
    relevantLogIds,
  };
}

const needsAttention = (label) => label === LABEL.NEAR_MISS || label === LABEL.IN_HISTORY;

module.exports = { LABEL, EXTRA_REASON, SUGGESTED_PERCENT, classifyAnswer, needsAttention, maxTypoDistance };

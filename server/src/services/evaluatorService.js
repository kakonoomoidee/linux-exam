/**
 * Turns a raw shell command string into a canonical form so trivial
 * whitespace/quoting differences don't cause a valid answer to be marked wrong.
 * Deliberately conservative: it does NOT try to understand shell semantics,
 * it just normalizes whitespace/quoting so accepted_patterns regexes stay simple.
 */
function normalizeCommand(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\s+/g, ' ')       // collapse repeated spaces/tabs
    .replace(/["']/g, '')        // drop quote characters
    .replace(/\.\//g, '');       // "./file" -> "file" (harmless leading ./)
}

/**
 * accepted_patterns: array of regex source strings (case-insensitive, anchored
 * loosely — write them anchored with ^...$ yourself if you want exact match).
 * Returns the first pattern that matched, or null.
 */
function matchesAnyPattern(normalizedCmd, patterns) {
  if (!patterns || patterns.length === 0) return null;
  for (const patternSrc of patterns) {
    try {
      const re = new RegExp(patternSrc, 'i');
      if (re.test(normalizedCmd)) return patternSrc;
    } catch (err) {
      // a malformed regex in question data shouldn't crash grading
      console.error(`[evaluator] invalid pattern skipped: ${patternSrc}`, err.message);
    }
  }
  return null;
}

/**
 * Given one command log line + a list of not-yet-solved questions for this variant,
 * returns the first question it solves (command_match / both check_type), or null.
 * Caller is responsible for state_check-only questions (evaluated at session end).
 */
function evaluateCommandAgainstQuestions(normalizedCmd, exitCode, candidateQuestions) {
  if (exitCode !== 0) return null; // failed commands never award points

  for (const q of candidateQuestions) {
    if (q.check_type === 'state_check') continue; // handled separately at end-of-session
    const patterns = JSON.parse(q.accepted_patterns || '[]');
    const matched = matchesAnyPattern(normalizedCmd, patterns);
    if (matched) return { question: q, matchedPattern: matched };
  }
  return null;
}

module.exports = {
  normalizeCommand,
  matchesAnyPattern,
  evaluateCommandAgainstQuestions,
};

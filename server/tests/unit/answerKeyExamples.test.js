/**
 * Every example answer shipped with the repo's question banks must actually be
 * accepted by the grader for its question, and every pattern needs at least
 * one example (unless the pattern can never match — the demo bank keeps one on
 * purpose to exercise the "too strict" detector). A wrong example fails here.
 */
const path = require('node:path');
const { normalizeCommand, matchesAnyPattern } = require('../../src/services/evaluatorService');
const { normalizationConflict, MAX_EXAMPLES_PER_PATTERN } = require('../../src/services/answerKeyService');
const { parseWorkbook } = require('../../src/services/importService');
const sampleQuestions = require('../../src/scripts/sampleQuestions');
const { bank: demoBank } = require('../../src/scripts/reviewDemoData');

const banks = {
  'seed (src/scripts/sampleQuestions.js)': sampleQuestions,
  'demo (src/scripts/reviewDemoData.js)': demoBank,
  'docs/contoh-bank-soal.xlsx': parseWorkbook(path.join(__dirname, '../../../docs/contoh-bank-soal.xlsx')),
};

const label = (q) => `v${q.variant_index} ucp${q.ucp ?? 1} #${q.order_index}`;
const cases = Object.entries(banks).flatMap(([bank, qs]) => qs.map((q) => [bank, label(q), q]));

describe.each(cases)('%s %s', (_bank, _label, q) => {
  const patterns = q.accepted_patterns || [];
  const examples = q.sample_answers || [];

  test('has at least one example answer', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  if (patterns.length) {
    test.each(examples)('example %p is accepted by the grader', (example) => {
      expect(matchesAnyPattern(normalizeCommand(example), patterns)).not.toBeNull();
    });

    test.each(patterns)('pattern %p has 1-3 examples (or can never match)', (pattern) => {
      const mine = examples.filter((ex) => matchesAnyPattern(normalizeCommand(ex), [pattern]));
      if (normalizationConflict(pattern)) return expect(mine).toHaveLength(0);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.length).toBeLessThanOrEqual(MAX_EXAMPLES_PER_PATTERN);
    });
  }
});

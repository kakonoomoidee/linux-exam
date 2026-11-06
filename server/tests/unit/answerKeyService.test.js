const { exampleFromPattern } = require('../../src/lib/regexExample');
const {
  buildAnswerKey,
  validateSampleAnswers,
  explainStateChecker,
  normalizationConflict,
  derivedExample,
} = require('../../src/services/answerKeyService');

const q = (over = {}) => ({
  check_type: 'command_match',
  accepted_patterns: JSON.stringify(['^ls$']),
  sample_answers: null,
  state_checker_script: null,
  ...over,
});

describe('exampleFromPattern (regex -> readable command)', () => {
  test.each([
    ['^head\\s+-n?\\s?5\\s+log\\.txt$', 'head -n 5 log.txt'],
    ['^ls\\s+(~/)?Music/?$', 'ls Music'],
    ['^ls(\\s+-[a-zA-Z]+)?\\s*\\x7c\\s*grep\\s+[\\"\']?\\S*txt\\S*[\\"\']?$', 'ls | grep txt'],
    ['^tar\\s+-?[cvj]*c[cvj]*j[cvj]*f\\s+\\S+\\.(tar\\.bz2)\\s+\\S+$', 'tar -cjf file.tar.bz2 file'],
    ['^(less|more)\\s+\\S+$', 'less file'],
    ['^cd\\s+\\$HOME$', 'cd $HOME'],
    ['^ip\\s+a(ddr)?(\\s+show)?$', 'ip a'],
  ])('%s -> %s', (pattern, expected) => {
    expect(exampleFromPattern(pattern)).toBe(expected);
  });

  test.each([['(?=x)ls'], ['(a)\\1'], [''], [null]])('unsupported / empty %p -> null', (pattern) => {
    expect(exampleFromPattern(pattern)).toBeNull();
  });
});

describe('derivedExample / normalizationConflict', () => {
  test('a derived example is only returned when the grader accepts it', () => {
    expect(derivedExample('^mkdir\\s+laporan$')).toBe('mkdir laporan');
  });

  test.each([
    ['^echo\\s+"Halo Linux"$', 'echo "Halo Linux"'], // quotes are stripped by normalizeCommand
    ['^\\./run\\.sh$', './run.sh'], // ./ is stripped too
  ])('%s can never match after normalization', (pattern, example) => {
    expect(derivedExample(pattern)).toBeNull();
    expect(normalizationConflict(pattern)).toBe(example);
  });

  test('a normal pattern has no conflict', () => {
    expect(normalizationConflict('^echo\\s+Halo Linux$')).toBeNull();
  });
});

describe('buildAnswerKey', () => {
  test('stored examples are grouped under the pattern they match; a pattern without one gets a derived example', () => {
    const key = buildAnswerKey(q({
      accepted_patterns: JSON.stringify(['^cat\\s+a\\.txt$', '^less\\s+a\\.txt$']),
      sample_answers: JSON.stringify(['cat a.txt', 'cat  "a.txt"']),
    }));
    expect(key.patterns[0]).toMatchObject({ examples: ['cat a.txt', 'cat  "a.txt"'], derived: false });
    expect(key.patterns[1]).toMatchObject({ examples: ['less a.txt'], derived: true });
    expect(key.examples).toEqual(['cat a.txt', 'cat  "a.txt"', 'less a.txt']);
  });

  test('state_check: stored examples are free-form and the checker is explained', () => {
    const key = buildAnswerKey(q({
      check_type: 'state_check',
      accepted_patterns: '[]',
      sample_answers: JSON.stringify(['mkdir ~/Desktop/UCP1']),
      state_checker_script: 'test -d ~/Desktop/UCP1 && echo PASS || echo FAIL',
    }));
    expect(key.patterns).toEqual([]);
    expect(key.examples).toEqual(['mkdir ~/Desktop/UCP1']);
    expect(key.stateChecks).toEqual([{ check: 'dir_exists', target: '~/Desktop/UCP1' }]);
  });

  test('malformed JSON in the row degrades to an empty key, not a crash', () => {
    expect(buildAnswerKey(q({ accepted_patterns: '{oops', sample_answers: 'nope' })).patterns).toEqual([]);
  });
});

describe('explainStateChecker', () => {
  test.each([
    ['test -f ~/Desktop/cisco && [ ! -e ~/cisco ] && echo PASS', [
      { check: 'file_exists', target: '~/Desktop/cisco' },
      { check: 'path_absent', target: '~/cisco' },
    ]],
    ['[ "$(stat -c %a ~/rahasia.txt 2>/dev/null)" = "600" ] && echo PASS || echo FAIL', [
      { check: 'permission', target: '~/rahasia.txt', value: '600' },
    ]],
    ['echo PASS', []],
    [null, []],
  ])('%p', (script, expected) => {
    expect(explainStateChecker(script)).toEqual(expected);
  });
});

describe('validateSampleAnswers', () => {
  const question = q({ accepted_patterns: JSON.stringify(['^ls$', '^ls\\s+-l$']) });

  test('accepts grader-valid answers and dedupes / trims', () => {
    expect(validateSampleAnswers(question, [' ls ', 'ls', 'ls -l'])).toEqual({ answers: ['ls', 'ls -l'], errors: [] });
  });

  test('rejects an answer no pattern accepts', () => {
    expect(validateSampleAnswers(question, ['ls -la']).errors).toEqual([{ answer: 'ls -la', error: 'no_pattern_match' }]);
  });

  test('rejects a 4th example for the same pattern', () => {
    const errors = validateSampleAnswers(q({ accepted_patterns: JSON.stringify(['^ls(\\s+-\\w)?$']) }), ['ls', 'ls -a', 'ls -l', 'ls -h']).errors;
    expect(errors).toEqual([{ answer: 'ls -h', error: 'too_many_for_pattern' }]);
  });

  test('state_check-only questions accept any command', () => {
    expect(validateSampleAnswers(q({ check_type: 'state_check', accepted_patterns: '[]' }), ['chmod 600 f']).errors).toEqual([]);
  });

  test('non-array input is rejected', () => {
    expect(validateSampleAnswers(question, 'ls').errors[0].error).toBe('not_array');
  });
});

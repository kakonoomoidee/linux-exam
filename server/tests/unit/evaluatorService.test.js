const {
  normalizeCommand,
  matchesAnyPattern,
  evaluateCommandAgainstQuestions,
} = require('../../src/services/evaluatorService');

// evaluateCommandAgainstQuestions reads q.accepted_patterns as a JSON *string*
// (that's how it comes off the DB row), so tests stringify.
const q = (over = {}) => ({
  id: 1,
  order_index: 1,
  check_type: 'command_match',
  point: 1,
  accepted_patterns: JSON.stringify(['^ls$']),
  ...over,
});

describe('normalizeCommand', () => {
  test.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('%s -> ""', (_label, input) => {
    expect(normalizeCommand(input)).toBe('');
  });

  test('collapses runs of whitespace in the middle and trims the ends', () => {
    expect(normalizeCommand('   cat    a.txt   ')).toBe('cat a.txt');
  });

  test('treats tabs like spaces', () => {
    expect(normalizeCommand('cat\t\ta.txt')).toBe('cat a.txt');
  });

  test('drops single and double quotes, mixed', () => {
    expect(normalizeCommand(`echo "a"'b'`)).toBe('echo ab');
  });

  test('strips ./ anywhere in the path, not just leading', () => {
    expect(normalizeCommand('cat ./dir/./file')).toBe('cat dir/file');
  });

  test('is a no-op for an already-clean command', () => {
    expect(normalizeCommand('ls -la')).toBe('ls -la');
  });

  test('is idempotent (running twice == running once)', () => {
    const messy = `  grep  -R   "./x"  './y'  `;
    const once = normalizeCommand(messy);
    expect(normalizeCommand(once)).toBe(once);
  });
});

describe('matchesAnyPattern', () => {
  test('empty / missing pattern list -> null', () => {
    expect(matchesAnyPattern('ls', [])).toBeNull();
    expect(matchesAnyPattern('ls', null)).toBeNull();
    expect(matchesAnyPattern('ls', undefined)).toBeNull();
  });

  test('single matching pattern -> returns that pattern source', () => {
    expect(matchesAnyPattern('ls', ['^ls$'])).toBe('^ls$');
  });

  test('returns the FIRST matching pattern when several match', () => {
    expect(matchesAnyPattern('ls', ['^ls$', 'ls'])).toBe('^ls$');
  });

  test('still finds a match at the LAST position', () => {
    expect(matchesAnyPattern('pwd', ['^ls$', '^cd$', '^pwd$'])).toBe('^pwd$');
  });

  test('an invalid regex is skipped without throwing, later patterns still tried', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(matchesAnyPattern('ok', ['(', '^ok$'])).toBe('^ok$');
    spy.mockRestore();
  });

  test('all patterns invalid -> null, no throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(matchesAnyPattern('ok', ['(', '['])).toBeNull();
    spy.mockRestore();
  });

  test('matching is case-insensitive', () => {
    expect(matchesAnyPattern('LS', ['^ls$'])).toBe('^ls$');
  });

  test('an unanchored pattern matches partially (by design — patterns bring their own ^...$)', () => {
    expect(matchesAnyPattern('cat foo.txt', ['cat'])).toBe('cat');
  });

  test('an anchored pattern does NOT match a superstring', () => {
    expect(matchesAnyPattern('ls -la', ['^ls$'])).toBeNull();
  });
});

describe('evaluateCommandAgainstQuestions', () => {
  test('exit code 0 + a matching question -> returns { question, matchedPattern }', () => {
    const res = evaluateCommandAgainstQuestions('ls', 0, [q()]);
    expect(res.question.id).toBe(1);
    expect(res.matchedPattern).toBe('^ls$');
  });

  test('non-zero exit code -> null even if the text matches', () => {
    expect(evaluateCommandAgainstQuestions('ls', 1, [q()])).toBeNull();
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('exit code %s -> null (only exactly 0 scores)', (_l, code) => {
    expect(evaluateCommandAgainstQuestions('ls', code, [q()])).toBeNull();
  });

  test('empty candidate list -> null', () => {
    expect(evaluateCommandAgainstQuestions('ls', 0, [])).toBeNull();
  });

  test('no candidate matches (all already solved / filtered out) -> null', () => {
    expect(evaluateCommandAgainstQuestions('whoami', 0, [q()])).toBeNull();
  });

  test('state_check questions are skipped entirely', () => {
    const stateOnly = q({ check_type: 'state_check', accepted_patterns: JSON.stringify(['^ls$']) });
    expect(evaluateCommandAgainstQuestions('ls', 0, [stateOnly])).toBeNull();
  });

  test('"both" questions ARE matched against the command', () => {
    const both = q({ check_type: 'both' });
    const res = evaluateCommandAgainstQuestions('ls', 0, [both]);
    expect(res.question.check_type).toBe('both');
  });

  test('a question with null accepted_patterns is handled (JSON.parse fallback to [])', () => {
    const noPatterns = q({ accepted_patterns: null });
    expect(evaluateCommandAgainstQuestions('ls', 0, [noPatterns])).toBeNull();
  });

  test('when a command could match >1 question, the earlier one in the list wins', () => {
    const first = q({ id: 10, order_index: 1 });
    const second = q({ id: 20, order_index: 2 });
    const res = evaluateCommandAgainstQuestions('ls', 0, [first, second]);
    expect(res.question.id).toBe(10);
  });
});

/**
 * "Hampir benar" detection, one case per category. Questions come from the
 * repo's own banks (seed / demo / docs xlsx) so these are real patterns.
 */
const { classifyAnswer, LABEL, maxTypoDistance } = require('../../src/services/nearMissService');
const { commandVariants, canonicalCommand } = require('../../src/lib/commandVariants');
const { editDistance } = require('../../src/lib/editDistance');
const { bank } = require('../../src/scripts/reviewDemoData');

const asRow = (q, id) => ({ ...q, id, accepted_patterns: JSON.stringify(q.accepted_patterns),
  sample_answers: JSON.stringify(q.sample_answers || []) });
const byKey = Object.fromEntries(bank.map((q, i) => [`${q.variant_index}.${q.order_index}`, asRow(q, i + 1)]));
const MEMINFO = byKey['0.1']; // head -n 5 /proc/meminfo
const MUSIC = byKey['0.2']; // ^ls\s+Music$  (deliberately strict)
const DESKTOP = byKey['0.3']; // state_check test -d ~/Desktop/laporan
const TXT = byKey['0.4']; // ^ls\s*\|\s*grep\s+txt$
const VAR = byKey['0.5']; // nama=tekser; echo $nama
const DOCS = byKey['1.2']; // ^cd\s+(~/)?Documents/?$
const HALO = byKey['1.5']; // echo Halo Linux (+ an unreachable quoted pattern)
const SEED_CAT = { id: 99, check_type: 'command_match', sample_answers: null,
  accepted_patterns: JSON.stringify(['^cat\\s+mahasiswa\\.txt$', '^less\\s+mahasiswa\\.txt$', '^more\\s+mahasiswa\\.txt$']) };

let nextId = 1;
const log = (raw_command, exit_code = 0, extra = {}) => ({ id: nextId++, raw_command, exit_code, question_id: null, ...extra });
const classify = (question, commands, submission = { auto_result: 'fail', auto_score: 0 }) =>
  classifyAnswer({ question, submission, commands });

describe('labels', () => {
  test('auto-pass -> correct, graded command reported', () => {
    const l = log('head -n 5 /proc/meminfo');
    const r = classify(MEMINFO, [l], { auto_result: 'pass', matched_command_log_id: l.id });
    expect(r).toMatchObject({ label: LABEL.CORRECT, gradedLogId: l.id, suggestedPercent: 100 });
  });

  test('"Benar di riwayat": a history command matches but was not graded', () => {
    const l = log('head -5 /proc/meminfo');
    const r = classify(MEMINFO, [log('pwd'), l]);
    expect(r).toMatchObject({ label: LABEL.IN_HISTORY, candidateLogId: l.id, reasons: ['in_history'], suggestedPercent: 100 });
    expect(r.matchedLogIds).toEqual([l.id]);
  });

  test('a command that scored ANOTHER question is not counted for this one', () => {
    const l = log('ls Music');
    const r = classifyAnswer({ question: MUSIC, submission: null, commands: [l], foreignMatchIds: new Set([l.id]) });
    expect(r.label).toBe(LABEL.WRONG);
  });

  test('far from the key -> wrong, with a reason', () => {
    expect(classify(MEMINFO, [log('whoami')])).toMatchObject({ label: LABEL.WRONG, reasons: ['no_close_command'], suggestedPercent: 0 });
    expect(classify(MEMINFO, [])).toMatchObject({ label: LABEL.WRONG, reasons: ['no_commands'] });
  });
});

describe('"hampir benar" categories', () => {
  test.each([
    ['trailing slash', MUSIC, 'ls Music/', ['trailing_slash'], 100],
    ['~/ vs relative path', MUSIC, 'ls ~/Music', ['home_path'], 75],
    ['/home/<user>/ path', DOCS, 'cd /home/student/Documents', ['home_path'], 75],
    ['spacing around a pipe', { ...TXT, accepted_patterns: JSON.stringify(['^ls\\s+\\x7c\\s+grep\\s+txt$']) },
      'ls|grep txt', ['spacing'], 100],
    ['flag style -n5 vs -n 5', { ...MEMINFO, accepted_patterns: JSON.stringify(['^head\\s+-n\\s+5\\s+/proc/meminfo$']) },
      'head -n5 /proc/meminfo', ['flag_style'], 100],
    ['equivalent: ls *.txt', TXT, 'ls *.txt', ['equivalent'], 75],
    ['equivalent: extra flags', MUSIC, 'ls -l Music', ['equivalent'], 75],
    ['equivalent: cat f | less', { ...SEED_CAT, accepted_patterns: JSON.stringify(['^less\\s+mahasiswa\\.txt$']) },
      'cat mahasiswa.txt | less', ['equivalent'], 75],
    ['typo (swapped letters, failed)', MUSIC, ['sl Music', 127], ['typo', 'failed_exit'], 50],
    ['typo in file name', DOCS, ['cd Documnets', 1], ['typo', 'failed_exit'], 50],
    ['split into two commands', VAR, [['nama=tekser'], ['echo $nama']], ['split_commands'], 75],
    ['state_check: touched the target path', DESKTOP, 'mkdir laporan', ['state_target', 'state_failed'], 50],
    ['state_check: same as an example', DESKTOP, 'mkdir -p ~/Desktop/laporan', ['cosmetic', 'state_failed'], 75],
  ])('%s', (_name, question, input, reasons, percent) => {
    const cmds = Array.isArray(input) && Array.isArray(input[0])
      ? input.map(([c, e]) => log(c, e ?? 0))
      : [Array.isArray(input) ? log(input[0], input[1]) : log(input)];
    const r = classify(question, cmds);
    expect(r).toMatchObject({ label: LABEL.NEAR_MISS, reasons, suggestedPercent: percent });
  });

  test('raw command matches a quote-requiring pattern -> "quotes" (pattern is the problem)', () => {
    const strict = { ...HALO, accepted_patterns: JSON.stringify(['^echo\\s+"Halo Linux"$']) };
    expect(classify(strict, [log('echo "Halo Linux"')])).toMatchObject({ label: LABEL.NEAR_MISS, reasons: ['quotes'], suggestedPercent: 100 });
  });

  test('a matching command that failed (exit != 0) is a near miss, not correct', () => {
    expect(classify(SEED_CAT, [log('cat mahasiswa.txt', 1)])).toMatchObject({ label: LABEL.NEAR_MISS, reasons: ['failed_exit'] });
  });

  test('the best candidate wins: a 100% variant beats an earlier 50% typo', () => {
    const typo = log('sl Music', 127);
    const slash = log('ls Music/');
    expect(classify(MUSIC, [typo, slash])).toMatchObject({ candidateLogId: slash.id, suggestedPercent: 100 });
  });

  test('short commands are never called typos (ls vs cd)', () => {
    const q = { id: 7, check_type: 'command_match', accepted_patterns: JSON.stringify(['^cd$']), sample_answers: null };
    expect(classify(q, [log('ls')]).label).toBe(LABEL.WRONG);
  });

  test('relevant history includes attributed + same-command entries, not unrelated ones', () => {
    const a = log('ls Music/');
    const b = log('whoami');
    const c = log('pwd', 0, { question_id: MUSIC.id });
    expect(classify(MUSIC, [a, b, c]).relevantLogIds).toEqual([a.id, c.id]);
  });
});

describe('helpers', () => {
  test('editDistance counts an adjacent swap as one edit', () => {
    expect(editDistance('sl', 'ls')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });

  test('maxTypoDistance grows with length and is 0 for tiny commands', () => {
    expect([3, 6, 15, 40].map(maxTypoDistance)).toEqual([0, 1, 2, 3]);
  });

  test('canonicalCommand ignores case, quotes, operator spacing, trailing slash, ~/ and flag order', () => {
    expect(canonicalCommand('LS -al ~/Music/|grep "txt"')).toBe(canonicalCommand('ls -la Music | grep txt'));
  });

  test('commandVariants tags every variant with its reason', () => {
    const variants = commandVariants('ls -la ~/Music/');
    expect(variants).toEqual(expect.arrayContaining([
      { command: 'ls -la ~/Music', reasons: ['trailing_slash'] },
      { command: 'ls -al ~/Music/', reasons: ['flag_style'] },
    ]));
    expect(variants.find((v) => v.command === 'ls -la Music')).toBeDefined();
  });
});

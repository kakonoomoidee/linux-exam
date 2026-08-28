const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const XLSX = require('xlsx');

const { parseWorkbook, importFromFile } = require('../../src/services/importService');
const { useTestDb } = require('../helpers/db');

useTestDb();

const tmpFiles = [];
afterEach(() => {
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
});

/** sheets: { "Sheet Name": [ {header: value, ...}, ... ] } — [] means header-only (0 data rows). */
function makeWorkbook(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = rows.length
      ? XLSX.utils.json_to_sheet(rows)
      : XLSX.utils.aoa_to_sheet([['order', 'story', 'point']]); // headers, no data
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const p = path.join(os.tmpdir(), `tekser-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  tmpFiles.push(p);
  return p;
}

const mute = () => jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('parseWorkbook — sheet handling', () => {
  test('infers the variant from a trailing digit in the sheet name', () => {
    const f = makeWorkbook({ 'Variant 5': [{ order: 1, story: 'do X', point: 2 }] });
    const [q] = parseWorkbook(f);
    expect(q).toMatchObject({ variant_index: 5, order_index: 1, story_text: 'do X', point: 2 });
  });

  test('a sheet whose name has no digit and rows with no variant column are skipped with a warning', () => {
    const spy = mute();
    const f = makeWorkbook({ Praktikum: [{ order: 1, story: 'orphan row' }] });
    expect(parseWorkbook(f)).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('a sheet with zero data rows is skipped', () => {
    const f = makeWorkbook({ 'Variant 3': [] });
    expect(parseWorkbook(f)).toEqual([]);
  });

  test('an explicit variant column overrides the sheet-name digit', () => {
    const f = makeWorkbook({ 'Variant 5': [{ variant: 3, order: 1, story: 's' }] });
    expect(parseWorkbook(f)[0].variant_index).toBe(3);
  });

  test('story text is trimmed and order defaults to the row position', () => {
    const f = makeWorkbook({ 'Variant 1': [{ story: '  spaced  ' }, { story: 'second' }] });
    const qs = parseWorkbook(f);
    expect(qs[0]).toMatchObject({ story_text: 'spaced', order_index: 1 });
    expect(qs[1].order_index).toBe(2);
  });
});

describe('parseWorkbook — field parsing', () => {
  test('an empty point cell defaults to 1', () => {
    const f = makeWorkbook({ 'Variant 1': [{ order: 1, story: 's', point: '' }] });
    expect(parseWorkbook(f)[0].point).toBe(1);
  });

  test('accepted_patterns splits on pipe and trims whitespace around each pattern', () => {
    const f = makeWorkbook({
      'Variant 1': [{ order: 1, story: 's', accepted_patterns: '^a$ | ^b$ |^c$' }],
    });
    expect(parseWorkbook(f)[0].accepted_patterns).toEqual(['^a$', '^b$', '^c$']);
  });

  test('column headers are matched case-insensitively and space-insensitively', () => {
    const f = makeWorkbook({
      'Variant 2': [{ ORDER: 1, Story: 'hello', 'Accepted Patterns': '^ls$', Point: 3 }],
    });
    expect(parseWorkbook(f)[0]).toMatchObject({
      order_index: 1,
      story_text: 'hello',
      accepted_patterns: ['^ls$'],
      point: 3,
    });
  });

  test('unknown columns are ignored, not fatal', () => {
    const f = makeWorkbook({ 'Variant 1': [{ order: 1, story: 's', nonsense_column: 'whatever' }] });
    expect(() => parseWorkbook(f)).not.toThrow();
    expect(parseWorkbook(f)).toHaveLength(1);
  });

  // --- documented current behaviour (see FINDINGS in the PR): no validation ---
  test('FINDING: a non-numeric point becomes NaN (not rejected, not defaulted)', () => {
    const f = makeWorkbook({ 'Variant 1': [{ order: 1, story: 's', point: 'abc' }] });
    expect(Number.isNaN(parseWorkbook(f)[0].point)).toBe(true);
  });

  test('FINDING: an unknown check_type is passed straight through, unvalidated', () => {
    const f = makeWorkbook({ 'Variant 1': [{ order: 1, story: 's', check_type: 'typoo' }] });
    expect(parseWorkbook(f)[0].check_type).toBe('typoo');
  });

  test('FINDING: a command_match question with no accepted_patterns parses fine (unanswerable)', () => {
    const f = makeWorkbook({
      'Variant 1': [{ order: 1, story: 's', check_type: 'command_match', accepted_patterns: '' }],
    });
    expect(parseWorkbook(f)[0].accepted_patterns).toEqual([]);
  });
});

describe('importFromFile (persists via Question.create)', () => {
  test('imports valid rows and reports the count', async () => {
    const f = makeWorkbook({
      'Variant 4': [
        { order: 1, story: 'q one', point: 1, accepted_patterns: '^ls$' },
        { order: 2, story: 'q two', point: 2, accepted_patterns: '^pwd$' },
      ],
    });
    const res = await importFromFile(f);
    expect(res).toMatchObject({ totalRows: 2, created: 2 });
    expect(res.errors).toHaveLength(0);

    const Question = require('../../src/models/Question');
    const stored = await Question.listForVariantIndex(4);
    expect(stored).toHaveLength(2);
  });

  test('rejects a row with an empty story but still imports the others', async () => {
    const f = makeWorkbook({
      'Variant 6': [
        { order: 1, story: '', point: 1 },
        { order: 2, story: 'valid one', point: 1, accepted_patterns: '^ls$' },
      ],
    });
    const res = await importFromFile(f);
    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].error).toMatch(/story_text kosong/);
  });
});

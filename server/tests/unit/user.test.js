const User = require('../../src/models/User');
const db = require('../../src/db/connection');
const { useTestDb } = require('../helpers/db');

useTestDb();

describe('User.variantIndexForNim (pure)', () => {
  test.each([
    ['20220140055', 5],
    ['20220140050', 0],
    ['12345', 5],
    ['7', 7],
    ['abc123def456', 6],
    ['nim-7-suffix', 7], // last digit anywhere in the string
    ['202201400a', 0], // last digit is the 0 before the letter
    ['2022 0140 055 ', 5], // trailing whitespace, digits still found
    ['', 0], // no digit -> fallback 0
    ['abc', 0],
    [null, 0], // String(null) = "null", no digit
    [undefined, 0],
  ])('%p -> variant %i', (nim, expected) => {
    expect(User.variantIndexForNim(nim)).toBe(expected);
  });
});

describe('User.findOrCreateStudent', () => {
  test('returns the existing row and creates no duplicate when the NIM is known', async () => {
    const first = await User.create({ nim: '20220140001', name: 'A' });
    const again = await User.findOrCreateStudent('20220140001', 'A');
    expect(again.id).toBe(first.id);
    const { count } = await db.get(`SELECT count(*)::int FROM users WHERE nim = '20220140001'`);
    expect(count).toBe(1);
  });

  test('creates a new student row for an unknown NIM', async () => {
    const created = await User.findOrCreateStudent('20220140002', 'New');
    expect(created.id).toBeDefined();
    expect(created.role).toBe('student');
    expect(created.name).toBe('New');
  });

  test('backfills a name onto a previously name-less row', async () => {
    await User.create({ nim: '20220140003', name: null });
    const filled = await User.findOrCreateStudent('20220140003', 'Later Name');
    expect(filled.name).toBe('Later Name');
    const { count } = await db.get(`SELECT count(*)::int FROM users WHERE nim = '20220140003'`);
    expect(count).toBe(1);
  });

  test('does NOT overwrite an existing name', async () => {
    await User.create({ nim: '20220140004', name: 'Original' });
    const res = await User.findOrCreateStudent('20220140004', 'Different');
    expect(res.name).toBe('Original');
  });

  test('two sequential calls with the same NIM yield exactly one row', async () => {
    await User.findOrCreateStudent('20220140005', 'X');
    await User.findOrCreateStudent('20220140005', 'X');
    const { count } = await db.get(`SELECT count(*)::int FROM users WHERE nim = '20220140005'`);
    expect(count).toBe(1);
  });

  test('concurrent calls race, but the unique constraint still leaves exactly one row', async () => {
    // findOrCreateStudent is not race-safe on its own (check-then-insert); the
    // users.nim UNIQUE constraint is what actually prevents a duplicate.
    const results = await Promise.allSettled([
      User.findOrCreateStudent('20220140006', 'Y'),
      User.findOrCreateStudent('20220140006', 'Y'),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    const { count } = await db.get(`SELECT count(*)::int FROM users WHERE nim = '20220140006'`);
    expect(count).toBe(1);
  });
});

const { normalizeKelas, salvageKelas } = require('../../src/lib/kelas');

describe('normalizeKelas (strict — live input)', () => {
  test.each([
    ['A', 'A'],
    ['f', 'F'],
    ['  c  ', 'C'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeKelas(input)).toBe(expected);
  });

  test.each(['', null, undefined, 'G', 'AA', 'TI-3A', '3', 'a1'])('%j -> null', (input) => {
    expect(normalizeKelas(input)).toBeNull();
  });
});

describe('salvageKelas (lenient — one-time migration)', () => {
  test.each([
    ['TI-3A', 'A'],
    ['kelas b', 'B'],
    ['SI-2C', 'C'],
    ['d', 'D'],
    ['  E ', 'E'],
  ])('%j -> %j', (input, expected) => {
    expect(salvageKelas(input)).toBe(expected);
  });

  test.each(['X9', 'TI-3Z', '', null, '123', 'TI-3'])('%j -> null', (input) => {
    expect(salvageKelas(input)).toBeNull();
  });

  test('is a fixpoint on already-normalized values', () => {
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) expect(salvageKelas(k)).toBe(k);
  });
});

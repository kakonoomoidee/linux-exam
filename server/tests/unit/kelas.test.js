const { normalizeKelas, salvageKelas } = require('../../src/lib/kelas');

describe('normalizeKelas (live input — A–F plus ad-hoc class codes)', () => {
  test.each([
    ['A', 'A'],
    ['f', 'F'],
    ['  c  ', 'C'],
    ['g', 'G'],
    ['ti-3a', 'TI-3A'],
    ['b1', 'B1'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeKelas(input)).toBe(expected);
  });

  test.each(['', null, undefined, 'a b', 'TI_3A', 'WAY-TOO-LONG-CODE', 'x!'])('%j -> null', (input) => {
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

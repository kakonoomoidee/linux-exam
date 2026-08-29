const joinCode = require('../../src/lib/joinCode');

describe('joinCode.generate', () => {
  test('is 6 chars from the unambiguous alphabet, never 0/O/1/I', () => {
    for (let i = 0; i < 500; i++) {
      const code = joinCode.generate();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  test('does not return the same code twice in a row (probabilistic sanity)', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(joinCode.generate());
    expect(seen.size).toBeGreaterThan(190);
  });
});

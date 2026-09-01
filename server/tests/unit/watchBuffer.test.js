const {
  appendWatchBuffer,
  getWatchBuffer,
  closeWatch,
  watchBufferCount,
} = require('../../src/sockets/terminalSocket');

// unique token per test so leftover state can't bleed across cases
let n = 0;
const tok = () => `wb-test-${n++}`;

describe('watch ring buffer', () => {
  test('caps at 64KB, keeping the most recent bytes', () => {
    const t = tok();
    appendWatchBuffer(t, 'x'.repeat(70000));
    appendWatchBuffer(t, 'abc');
    const buf = getWatchBuffer(t);
    expect(buf.length).toBe(64 * 1024);
    expect(buf.endsWith('abc')).toBe(true);
    closeWatch(null, t);
  });

  test('unknown token reads as empty string', () => {
    expect(getWatchBuffer('never-seen')).toBe('');
  });

  test('closeWatch notifies the watch room and frees the entry', () => {
    const t = tok();
    appendWatchBuffer(t, 'hello');
    const io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };
    closeWatch(io, t);
    expect(io.to).toHaveBeenCalledWith(`watch:${t}`);
    expect(io.emit).toHaveBeenCalledWith('terminal:closed');
    expect(getWatchBuffer(t)).toBe('');
  });

  test('does not accumulate: every closeWatch removes its entry', () => {
    const before = watchBufferCount();
    const tokens = Array.from({ length: 20 }, () => tok());
    tokens.forEach((t) => appendWatchBuffer(t, 'data'));
    expect(watchBufferCount()).toBe(before + 20);
    tokens.forEach((t) => closeWatch(null, t));
    expect(watchBufferCount()).toBe(before);
  });
});

const { buildTelegram, MockTelegram } = require('../../src/lib/telegram');

// No DB — pure unit test of the disabled/mock transport.
describe('lib/telegram (disabled / mock mode)', () => {
  test('buildTelegram() returns a MockTelegram when no bot token is set', () => {
    expect(buildTelegram()).toBeInstanceOf(MockTelegram);
  });

  test('sendMessage records to sent[] and never throws', async () => {
    const bot = new MockTelegram();
    await expect(bot.sendMessage(123, 'hi there')).resolves.toBeUndefined();
    expect(bot.sent).toEqual([{ chatId: '123', text: 'hi there' }]);
  });

  test('poll() just stores the handler (no network call)', async () => {
    const bot = new MockTelegram();
    const handler = jest.fn();
    await bot.poll(handler);
    expect(bot._handler).toBe(handler);
    expect(handler).not.toHaveBeenCalled();
  });

  test('_reset() clears the outbox', async () => {
    const bot = new MockTelegram();
    await bot.sendMessage(1, 'a');
    bot._reset();
    expect(bot.sent).toEqual([]);
  });
});

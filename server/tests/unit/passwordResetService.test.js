const { useTestDb } = require('../helpers/db');
const { createStudent } = require('../helpers/factory');
const db = require('../../src/db/connection');
const { verify } = require('../../src/lib/password');
const svc = require('../../src/services/passwordResetService');
const telegram = require('../../src/services/telegramClient');

useTestDb();

beforeEach(() => {
  svc._resetState();
  telegram._reset();
});

async function bindTelegram(id, chatId = '55501') {
  await db.run('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [chatId, id]);
}
function lastOtp() {
  return telegram.sent[telegram.sent.length - 1].text.match(/\b(\d{6})\b/)[1];
}

describe('passwordResetService', () => {
  test('requestReset sends a 6-digit OTP for a bound student, hashed at rest', async () => {
    const s = await createStudent({ nim: '111' });
    await bindTelegram(s.id);
    await svc.requestReset('111');

    expect(telegram.sent).toHaveLength(1);
    const otp = lastOtp();
    expect(otp).toMatch(/^\d{6}$/);
    const row = await db.get('SELECT * FROM password_reset_otps WHERE user_id = $1', [s.id]);
    expect(row.otp_hash).not.toContain(otp);
  });

  test('requestReset is silent for an unknown NIM and for an unbound student', async () => {
    await createStudent({ nim: '222' }); // no Telegram
    await svc.requestReset('222');
    await svc.requestReset('does-not-exist');
    expect(telegram.sent).toHaveLength(0);
  });

  test('a new OTP request invalidates the previous one', async () => {
    const s = await createStudent({ nim: '333' });
    await bindTelegram(s.id);
    await svc.requestReset('333');
    const first = lastOtp();
    await svc.requestReset('333');
    const second = lastOtp();

    expect(second).not.toBe(first);
    expect((await svc.completeReset('333', first, 'brandnewpass')).ok).toBe(false);
    expect((await svc.completeReset('333', second, 'brandnewpass')).ok).toBe(true);
  });

  test('request throttle: max 3 per hour per NIM', async () => {
    const s = await createStudent({ nim: '444' });
    await bindTelegram(s.id);
    for (let i = 0; i < 3; i++) await svc.requestReset('444');
    expect(telegram.sent).toHaveLength(3);
    await svc.requestReset('444');
    expect(telegram.sent).toHaveLength(3); // 4th suppressed
  });

  test('request throttle window resets after an hour', async () => {
    const s = await createStudent({ nim: '555' });
    await bindTelegram(s.id);
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      for (let i = 0; i < 4; i++) await svc.requestReset('555');
      expect(telegram.sent).toHaveLength(3);
      jest.setSystemTime(new Date('2026-01-01T01:00:01Z')); // +1h1s
      await svc.requestReset('555');
      expect(telegram.sent).toHaveLength(4);
    } finally {
      jest.useRealTimers();
    }
  });

  test('OTP expires after the TTL', async () => {
    const s = await createStudent({ nim: '666' });
    await bindTelegram(s.id);
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      await svc.requestReset('666');
      const otp = lastOtp();
      jest.setSystemTime(new Date('2026-01-01T00:11:00Z')); // +11 min > 10 min TTL
      expect((await svc.completeReset('666', otp, 'brandnewpass')).ok).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('verify throttle: 5 wrong attempts then even the correct OTP is refused', async () => {
    const s = await createStudent({ nim: '777' });
    await bindTelegram(s.id);
    await svc.requestReset('777');
    const otp = lastOtp();
    for (let i = 0; i < 5; i++) {
      expect((await svc.completeReset('777', '000000', 'brandnewpass')).ok).toBe(false);
    }
    expect((await svc.completeReset('777', otp, 'brandnewpass')).ok).toBe(false); // throttled
  });

  test('completeReset sets the new password and clears must_change_password', async () => {
    const s = await createStudent({ nim: '888', must_change_password: true });
    await bindTelegram(s.id);
    await svc.requestReset('888');
    const otp = lastOtp();

    expect((await svc.completeReset('888', otp, 'a-solid-password')).ok).toBe(true);
    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.must_change_password).toBe(false);
    expect(await verify('a-solid-password', u.password_hash)).toBe(true);
  });

  test('weak new password is rejected distinctly, without consuming the OTP', async () => {
    const s = await createStudent({ nim: '999' });
    await bindTelegram(s.id);
    await svc.requestReset('999');
    const otp = lastOtp();

    expect(await svc.completeReset('999', otp, 'short')).toEqual({ ok: false, reason: 'weak' });
    expect(await svc.completeReset('999', otp, '999')).toEqual({ ok: false, reason: 'weak' });
    expect((await svc.completeReset('999', otp, 'a-good-password')).ok).toBe(true);
  });

  test('requestResetForUser mints an OTP for a chat-authenticated user (no NIM lookup)', async () => {
    const s = await createStudent({ nim: 'tg1' });
    await bindTelegram(s.id, '4242');
    const r = await svc.requestResetForUser({ id: s.id, nim: s.nim, telegram_chat_id: '4242' });
    expect(r).toEqual({ ok: true });
    expect(telegram.sent[0].chatId).toBe('4242');
    const row = await db.get('SELECT * FROM password_reset_otps WHERE user_id = $1 AND consumed_at IS NULL', [s.id]);
    expect(row).toBeTruthy();
    // the OTP still verifies through the normal completeReset path
    expect((await svc.completeReset('tg1', lastOtp(), 'a-good-password')).ok).toBe(true);
  });

  test('requestReset and requestResetForUser share one per-NIM request budget', async () => {
    const s = await createStudent({ nim: 'tg2' });
    await bindTelegram(s.id, '4343');
    const user = { id: s.id, nim: s.nim, telegram_chat_id: '4343' };
    await svc.requestReset('tg2'); // 1
    await svc.requestResetForUser(user); // 2
    await svc.requestReset('tg2'); // 3
    expect(await svc.requestResetForUser(user)).toEqual({ throttled: true }); // 4th, blocked
  });
});

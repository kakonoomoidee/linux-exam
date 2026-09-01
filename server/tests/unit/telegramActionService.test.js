const { useTestDb } = require('../helpers/db');
const db = require('../../src/db/connection');
const svc = require('../../src/services/telegramActionService');

useTestDb();

beforeEach(() => svc._resetState());

const CHAT = '900900';

describe('telegramActionService', () => {
  test('requestActionOtp mints a 6-digit code, hashed at rest', async () => {
    const { code } = await svc.requestActionOtp(CHAT, 'unlink');
    expect(code).toMatch(/^\d{6}$/);
    const row = await db.get(`SELECT * FROM telegram_action_otps WHERE chat_id = $1`, [CHAT]);
    expect(row.action).toBe('unlink');
    expect(row.otp_hash).not.toContain(code);
  });

  test('a fresh request invalidates the previous pending code', async () => {
    const first = (await svc.requestActionOtp(CHAT, 'unlink')).code;
    const second = (await svc.requestActionOtp(CHAT, 'unlink')).code;
    expect(second).not.toBe(first);
    expect((await svc.confirmActionOtp(CHAT, 'unlink', first)).ok).toBe(false);
    expect((await svc.confirmActionOtp(CHAT, 'unlink', second)).ok).toBe(true);
  });

  test('confirmActionOtp consumes the code on success (single use)', async () => {
    const { code } = await svc.requestActionOtp(CHAT, 'unlink');
    expect((await svc.confirmActionOtp(CHAT, 'unlink', code)).ok).toBe(true);
    expect((await svc.confirmActionOtp(CHAT, 'unlink', code)).ok).toBe(false);
  });

  test('request throttle: max 3 per hour per (chat, action), resets after the window', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      for (let i = 0; i < 3; i++) expect((await svc.requestActionOtp(CHAT, 'unlink')).code).toBeDefined();
      expect((await svc.requestActionOtp(CHAT, 'unlink')).throttled).toBe(true);
      jest.setSystemTime(new Date('2026-01-01T01:00:01Z'));
      expect((await svc.requestActionOtp(CHAT, 'unlink')).code).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('verify throttle: 5 wrong then the correct code is refused too', async () => {
    const { code } = await svc.requestActionOtp(CHAT, 'unlink');
    for (let i = 0; i < 5; i++) expect((await svc.confirmActionOtp(CHAT, 'unlink', '000000')).ok).toBe(false);
    expect((await svc.confirmActionOtp(CHAT, 'unlink', code)).ok).toBe(false);
  });

  test('a code expires after the TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      const { code } = await svc.requestActionOtp(CHAT, 'unlink');
      jest.setSystemTime(new Date('2026-01-01T00:06:00Z')); // +6 min > 5 min TTL
      expect((await svc.confirmActionOtp(CHAT, 'unlink', code)).ok).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('throttle is per (chat, action) pair', async () => {
    for (let i = 0; i < 3; i++) await svc.requestActionOtp(CHAT, 'unlink');
    expect((await svc.requestActionOtp(CHAT, 'unlink')).throttled).toBe(true);
    expect((await svc.requestActionOtp(CHAT, 'other')).code).toBeDefined();
    expect((await svc.requestActionOtp('111', 'unlink')).code).toBeDefined();
  });
});

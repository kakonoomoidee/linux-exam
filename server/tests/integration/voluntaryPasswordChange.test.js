const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent } = require('../helpers/factory');
const db = require('../../src/db/connection');
const { checkStudentPassword } = require('../../src/lib/password');
const telegram = require('../../src/services/telegramClient');
const telegramActionService = require('../../src/services/telegramActionService');

useTestDb();
const app = buildApp();

beforeEach(() => {
  telegram._reset();
  telegramActionService._resetState();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const bind = (id, chatId = '7001') =>
  db.run('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [chatId, id]);
const otpFromTelegram = () => telegram.sent[telegram.sent.length - 1].text.match(/\b(\d{6})\b/)[1];

describe('POST /api/me/password/change-otp', () => {
  test('wrong current password -> 400, no code sent', async () => {
    const s = await createStudent({ nim: 'v1', password: 'currentpass1' });
    await bind(s.id);
    const res = await request(app)
      .post('/api/me/password/change-otp')
      .set(auth(s.token))
      .send({ currentPassword: 'nope' });
    expect(res.status).toBe(400);
    expect(telegram.sent).toHaveLength(0);
  });

  test('Telegram not linked -> 409 telegram_not_linked', async () => {
    const s = await createStudent({ nim: 'v2', password: 'currentpass1' });
    const res = await request(app)
      .post('/api/me/password/change-otp')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'telegram_not_linked' });
  });

  test('happy path -> 200, 6-digit code sent to the student chat', async () => {
    const s = await createStudent({ nim: 'v3', password: 'currentpass1' });
    await bind(s.id, '7003');
    const res = await request(app)
      .post('/api/me/password/change-otp')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].chatId).toBe('7003');
    expect(telegram.sent[0].text).toMatch(/\b\d{6}\b/);
  });

  test('4th request within the window is throttled -> 429', async () => {
    const s = await createStudent({ nim: 'v4', password: 'currentpass1' });
    await bind(s.id);
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post('/api/me/password/change-otp')
        .set(auth(s.token))
        .send({ currentPassword: 'currentpass1' });
      expect(r.status).toBe(200);
    }
    const throttled = await request(app)
      .post('/api/me/password/change-otp')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1' });
    expect(throttled.status).toBe(429);
  });
});

describe('POST /api/me/password/verified', () => {
  async function requestOtp(s) {
    await request(app)
      .post('/api/me/password/change-otp')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1' });
    return otpFromTelegram();
  }

  test('end to end: otp -> change -> login with the new password', async () => {
    const s = await createStudent({ nim: 'w1', password: 'currentpass1' });
    await bind(s.id);
    const otp = await requestOtp(s);

    const res = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1', newPassword: 'brandnewpass1', otp });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');

    const reloaded = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(await checkStudentPassword(reloaded, 'brandnewpass1')).toBe(true);
    expect(reloaded.must_change_password).toBe(false);

    const audit = await db.get(
      "SELECT * FROM audit_logs WHERE action = 'password_changed_2fa' AND target_user_id = $1",
      [s.id]
    );
    expect(audit).toBeTruthy();
  });

  test('wrong OTP -> 400, password unchanged', async () => {
    const s = await createStudent({ nim: 'w2', password: 'currentpass1' });
    await bind(s.id);
    await requestOtp(s);

    const res = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1', newPassword: 'brandnewpass1', otp: '000000' });
    expect(res.status).toBe(400);

    const reloaded = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(await checkStudentPassword(reloaded, 'currentpass1')).toBe(true);
  });

  test('wrong current password -> 400 even with a valid OTP', async () => {
    const s = await createStudent({ nim: 'w3', password: 'currentpass1' });
    await bind(s.id);
    const otp = await requestOtp(s);

    const res = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'wrong', newPassword: 'brandnewpass1', otp });
    expect(res.status).toBe(400);
  });

  test('new password equal to NIM -> 400, OTP not spent', async () => {
    const s = await createStudent({ nim: 'w4', password: 'currentpass1' });
    await bind(s.id);
    const otp = await requestOtp(s);

    const weak = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1', newPassword: 'w4', otp });
    expect(weak.status).toBe(400);

    // the same OTP still works once the password is acceptable
    const ok = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1', newPassword: 'brandnewpass1', otp });
    expect(ok.status).toBe(200);
  });

  test('not linked -> 409', async () => {
    const s = await createStudent({ nim: 'w5', password: 'currentpass1' });
    const res = await request(app)
      .post('/api/me/password/verified')
      .set(auth(s.token))
      .send({ currentPassword: 'currentpass1', newPassword: 'brandnewpass1', otp: '123456' });
    expect(res.status).toBe(409);
  });
});

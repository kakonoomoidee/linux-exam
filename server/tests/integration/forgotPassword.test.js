const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent } = require('../helpers/factory');
const db = require('../../src/db/connection');
const telegram = require('../../src/services/telegramClient');
const passwordResetService = require('../../src/services/passwordResetService');

useTestDb();
const app = buildApp();

const GENERIC = { message: 'Kalau NIM terdaftar dan Telegram sudah terhubung, OTP akan dikirim.' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  passwordResetService._resetState();
  telegram._reset();
});

async function bind(id, chatId = '9001') {
  await db.run('UPDATE users SET telegram_chat_id = $1, telegram_username = $2 WHERE id = $3', [chatId, 'budi', id]);
}
// requestReset runs fire-and-forget after the HTTP response, and does real bcrypt
// work before sending — poll until the OTP shows up.
async function waitForTelegram(n = 1) {
  for (let i = 0; i < 150; i++) {
    if (telegram.sent.length >= n) return;
    await sleep(20);
  }
  throw new Error(`telegram.sent never reached ${n} (got ${telegram.sent.length})`);
}
function otpFromTelegram() {
  return telegram.sent[telegram.sent.length - 1].text.match(/\b(\d{6})\b/)[1];
}

describe('POST /api/auth/forgot-password — identical response for every scenario', () => {
  test('unknown NIM -> generic 200, nothing sent', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ nim: 'ghost' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    await sleep(400);
    expect(telegram.sent).toHaveLength(0);
  });

  test('known NIM but no Telegram -> same generic 200, nothing sent', async () => {
    await createStudent({ nim: 'a1' });
    const res = await request(app).post('/api/auth/forgot-password').send({ nim: 'a1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    await sleep(400);
    expect(telegram.sent).toHaveLength(0);
  });

  test('known NIM + Telegram bound -> same generic 200, OTP sent to that chat', async () => {
    const s = await createStudent({ nim: 'a2' });
    await bind(s.id);
    const res = await request(app).post('/api/auth/forgot-password').send({ nim: 'a2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(GENERIC);
    await waitForTelegram(1);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].chatId).toBe('9001');
  });

  test('the response is returned without awaiting requestReset (fire-and-forget)', async () => {
    const s = await createStudent({ nim: 'a3' });
    await bind(s.id);
    let resolved = false;
    const spy = jest.spyOn(passwordResetService, 'requestReset').mockImplementation(async () => {
      await sleep(5000);
      resolved = true;
    });
    await request(app).post('/api/auth/forgot-password').send({ nim: 'a3' });
    expect(spy).toHaveBeenCalledWith('a3');
    expect(resolved).toBe(false); // response came back long before the 5s work finished
    spy.mockRestore();
  });
});

describe('POST /api/auth/reset-password', () => {
  test('end to end: request -> OTP -> reset -> login with the new password', async () => {
    const s = await createStudent({ nim: 'b1', password: 'b1', must_change_password: true });
    await bind(s.id);
    await request(app).post('/api/auth/forgot-password').send({ nim: 'b1' });
    await waitForTelegram(1);
    const otp = otpFromTelegram();

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ nim: 'b1', otp, newPassword: 'freshpass123' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login/student').send({ nim: 'b1', password: 'freshpass123' });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(false);
  });

  test('wrong OTP and unknown NIM return an identical 400', async () => {
    const s = await createStudent({ nim: 'b2' });
    await bind(s.id);
    await request(app).post('/api/auth/forgot-password').send({ nim: 'b2' });
    await waitForTelegram(1);

    const wrong = await request(app)
      .post('/api/auth/reset-password')
      .send({ nim: 'b2', otp: '000000', newPassword: 'freshpass123' });
    const unknown = await request(app)
      .post('/api/auth/reset-password')
      .send({ nim: 'nope', otp: '000000', newPassword: 'freshpass123' });

    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(wrong.body).toEqual(unknown.body);
  });

  test('weak new password returns the distinct policy message', async () => {
    const s = await createStudent({ nim: 'b3' });
    await bind(s.id);
    await request(app).post('/api/auth/forgot-password').send({ nim: 'b3' });
    await waitForTelegram(1);
    const otp = otpFromTelegram();

    const res = await request(app).post('/api/auth/reset-password').send({ nim: 'b3', otp, newPassword: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 karakter/);
  });

  test('request throttle still returns the generic 200', async () => {
    const s = await createStudent({ nim: 'b4' });
    await bind(s.id);
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/forgot-password').send({ nim: 'b4' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual(GENERIC);
    }
    await waitForTelegram(1);
    await sleep(300);
    expect(telegram.sent.length).toBeLessThanOrEqual(3);
  });
});

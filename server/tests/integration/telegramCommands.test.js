const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent, createAdmin } = require('../helpers/factory');
const db = require('../../src/db/connection');
const telegram = require('../../src/services/telegramClient');
const { handleMessage } = require('../../src/services/telegramBot');
const passwordResetService = require('../../src/services/passwordResetService');
const telegramActionService = require('../../src/services/telegramActionService');

useTestDb();
const app = buildApp();

beforeEach(() => {
  telegram._reset();
  passwordResetService._resetState();
  telegramActionService._resetState();
});

const CHAT = 700700;
async function linkStudent(nim = 'k1', chatId = CHAT) {
  const s = await createStudent({ nim, name: 'Kucing Oren' });
  await db.run('UPDATE users SET telegram_chat_id = $1, telegram_username = $2 WHERE id = $3', [
    String(chatId),
    'kucing',
    s.id,
  ]);
  return s;
}
const send = (text, chatId = CHAT) => handleMessage({ chat: { id: chatId, username: 'kucing' }, text });
const lastReply = () => telegram.sent[telegram.sent.length - 1].text;
const sixDigits = (str) => str.match(/\b(\d{6})\b/)[1];

describe('/status', () => {
  test('linked chat -> NIM + name', async () => {
    await linkStudent('k1');
    await send('/status');
    expect(lastReply()).toContain('k1');
    expect(lastReply()).toContain('Kucing Oren');
  });

  test('unlinked chat -> "belum terhubung"', async () => {
    await send('/status', 999999);
    expect(lastReply()).toMatch(/belum terhubung/i);
  });
});

describe('/changepass', () => {
  test('linked -> OTP row for that user + reply carries the code, the NIM and the hint', async () => {
    const s = await linkStudent('k2');
    await send('/changepass');
    const row = await db.get(`SELECT * FROM password_reset_otps WHERE user_id = $1 AND consumed_at IS NULL`, [s.id]);
    expect(row).toBeTruthy();
    expect(lastReply()).toMatch(/\d{6}/);
    expect(lastReply()).toContain('k2');
    expect(lastReply()).toMatch(/Lupa Password/i);
  });

  test('unlinked chat -> told to /start first, no OTP', async () => {
    await send('/changepass', 888888);
    expect(lastReply()).toMatch(/\/start/);
    const row = await db.get('SELECT count(*)::int AS n FROM password_reset_otps');
    expect(row.n).toBe(0);
  });

  test('4th request within the hour is throttled (shared per-NIM budget)', async () => {
    await linkStudent('k3');
    for (let i = 0; i < 3; i++) await send('/changepass');
    await send('/changepass');
    expect(lastReply()).toMatch(/terlalu banyak/i);
  });

  test('works for a bound staff chat too, and the OTP resets the staff password', async () => {
    const staff = await createAdmin({ nim: 'dosenTg', role: 'instruktur' });
    await db.run('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [String(CHAT), staff.id]);
    await send('/changepass');
    const row = await db.get(`SELECT * FROM password_reset_otps WHERE user_id = $1 AND consumed_at IS NULL`, [staff.id]);
    expect(row).toBeTruthy();
    const otp = sixDigits(lastReply());

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ nim: 'dosenTg', otp, newPassword: 'staff-fresh-pass' });
    expect(reset.status).toBe(200);
    const login = await request(app).post('/api/auth/login/admin').send({ nim: 'dosenTg', password: 'staff-fresh-pass' });
    expect(login.status).toBe(200);
  });
});

describe('/unlink + /confirm', () => {
  test('/unlink issues an action OTP; /confirm <right> unlinks + audits', async () => {
    const s = await linkStudent('k4');
    await send('/unlink');
    const row = await db.get(`SELECT * FROM telegram_action_otps WHERE chat_id = $1 AND action = 'unlink'`, [
      String(CHAT),
    ]);
    expect(row).toBeTruthy();
    expect(lastReply()).toMatch(/\/confirm/);
    const otp = sixDigits(lastReply());

    await send(`/confirm ${otp}`);
    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBeNull();
    const audit = await db.get(`SELECT * FROM audit_logs WHERE action = 'telegram_unlink_self'`);
    expect(audit.actor_id).toBe(s.id);
    expect(audit.metadata.source).toBe('telegram_confirm');
    expect(lastReply()).toMatch(/diputus/i);
  });

  test('/confirm <wrong> leaves the binding intact', async () => {
    const s = await linkStudent('k5');
    await send('/unlink');
    await send('/confirm 000000');
    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe(String(CHAT));
    expect(lastReply()).toMatch(/salah|kadaluarsa/i);
  });

  test('/unlink twice: only the second OTP works', async () => {
    await linkStudent('k6');
    await send('/unlink');
    const first = sixDigits(lastReply());
    await send('/unlink');
    const second = sixDigits(lastReply());
    expect(second).not.toBe(first);
    await send(`/confirm ${first}`);
    expect(lastReply()).toMatch(/salah|kadaluarsa/i);
    await send(`/confirm ${second}`);
    expect(lastReply()).toMatch(/diputus/i);
  });

  test('/confirm wrong x5 then the correct code is refused too', async () => {
    await linkStudent('k7');
    await send('/unlink');
    const otp = sixDigits(lastReply());
    for (let i = 0; i < 5; i++) await send('/confirm 111111');
    await send(`/confirm ${otp}`);
    expect(lastReply()).toMatch(/salah|kadaluarsa/i);
  });

  test('/confirm with no pending unlink -> refused, nothing changes', async () => {
    const s = await linkStudent('k8');
    await send('/confirm 123456');
    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe(String(CHAT));
    expect(lastReply()).toMatch(/salah|kadaluarsa/i);
  });

  test('/confirm with no argument -> format hint', async () => {
    await linkStudent('k9');
    await send('/confirm');
    expect(lastReply()).toMatch(/format/i);
  });
});

describe('the two OTP kinds are independent', () => {
  test('a /changepass OTP does not work as an /unlink /confirm', async () => {
    const s = await linkStudent('x1');
    await send('/changepass');
    const resetOtp = sixDigits(lastReply());
    await send(`/confirm ${resetOtp}`);
    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe(String(CHAT)); // still linked
    expect(lastReply()).toMatch(/salah|kadaluarsa/i);
  });

  test('an /unlink OTP does not work on POST /api/auth/reset-password', async () => {
    const s = await linkStudent('x2');
    await send('/unlink');
    const actionOtp = sixDigits(lastReply());
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ nim: 'x2', otp: actionOtp, newPassword: 'a-fresh-password' });
    expect(res.status).toBe(400);
    const login = await request(app).post('/api/auth/login/student').send({ nim: 'x2', password: 'a-fresh-password' });
    expect(login.status).not.toBe(200); // password never changed
  });
});

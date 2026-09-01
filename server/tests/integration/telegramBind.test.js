const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent, createAdmin, createAsisten } = require('../helpers/factory');
const db = require('../../src/db/connection');
const telegram = require('../../src/services/telegramClient');
const telegramBot = require('../../src/services/telegramBot');

useTestDb();
const app = buildApp();
const as = (u) => ({ Authorization: `Bearer ${u.token}` });

beforeEach(() => telegram._reset());

describe('self-service Telegram binding', () => {
  test('link-code -> /start <code> stores chat_id and writes a telegram_bind_self audit row', async () => {
    const s = await createStudent({ nim: 'c1' });
    const { body } = await request(app).post('/api/me/telegram/link-code').set(as(s)).expect(200);
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/);

    await telegramBot.handleMessage({ chat: { id: 424242, username: 'budi_tg' }, text: `/start ${body.code}` });

    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe('424242');
    expect(u.telegram_username).toBe('budi_tg');

    const audit = await db.get(`SELECT * FROM audit_logs WHERE action = 'telegram_bind_self'`);
    expect(audit.actor_id).toBe(s.id);
    expect(audit.target_user_id).toBe(s.id);
    expect(telegram.sent.some((m) => /berhasil terhubung/i.test(m.text))).toBe(true);
  });

  test('an expired code binds nothing and the bot says so', async () => {
    const s = await createStudent({ nim: 'c2' });
    const { body } = await request(app).post('/api/me/telegram/link-code').set(as(s));
    await db.run(`UPDATE telegram_link_codes SET expires_at = now() - interval '1 minute' WHERE code = $1`, [body.code]);

    await telegramBot.handleMessage({ chat: { id: 1, username: null }, text: `/start ${body.code}` });

    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBeNull();
    expect(telegram.sent.some((m) => /tidak valid|kadaluarsa/i.test(m.text))).toBe(true);
  });

  test('a consumed code cannot be reused', async () => {
    const s = await createStudent({ nim: 'c3' });
    const { body } = await request(app).post('/api/me/telegram/link-code').set(as(s));
    await telegramBot.handleMessage({ chat: { id: 10, username: null }, text: `/start ${body.code}` });
    telegram._reset();
    await telegramBot.handleMessage({ chat: { id: 20, username: null }, text: `/start ${body.code}` });

    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe('10'); // still the first chat
  });

  test('GET reports state; DELETE self-unlinks and audits it', async () => {
    const s = await createStudent({ nim: 'c4' });
    await db.run('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', ['77', s.id]);

    let res = await request(app).get('/api/me/telegram').set(as(s));
    expect(res.body).toEqual({ linked: true, username: null });

    await request(app).delete('/api/me/telegram').set(as(s)).expect(200);
    res = await request(app).get('/api/me/telegram').set(as(s));
    expect(res.body.linked).toBe(false);

    const audit = await db.get(`SELECT * FROM audit_logs WHERE action = 'telegram_bind_self' ORDER BY id DESC LIMIT 1`);
    expect(audit.metadata.unlinked).toBe(true);
  });
});

describe('staff override', () => {
  test('PATCH student telegram fields as asisten writes telegram_bind_staff_override', async () => {
    const asisten = await createAsisten();
    const s = await createStudent({ nim: 'd1' });

    const res = await request(app)
      .patch(`/api/admin/students/${s.id}`)
      .set(as(asisten))
      .send({ telegram_chat_id: '9988', telegram_username: '@dina' });
    expect(res.status).toBe(200);

    const u = await db.get('SELECT * FROM users WHERE id = $1', [s.id]);
    expect(u.telegram_chat_id).toBe('9988');
    expect(u.telegram_username).toBe('dina'); // leading @ stripped

    const audit = await db.get(`SELECT * FROM audit_logs WHERE action = 'telegram_bind_staff_override'`);
    expect(audit.actor_id).toBe(asisten.id);
    expect(audit.target_user_id).toBe(s.id);
    expect(audit.metadata.source).toBe('edit_modal');
  });

  test('a non-numeric chat id is rejected', async () => {
    const admin = await createAdmin();
    const s = await createStudent({ nim: 'd2' });
    const res = await request(app)
      .patch(`/api/admin/students/${s.id}`)
      .set(as(admin))
      .send({ telegram_chat_id: 'abc' });
    expect(res.status).toBe(400);
  });
});

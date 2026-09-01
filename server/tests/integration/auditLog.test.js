const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent, createAdmin, createAsisten } = require('../helpers/factory');
const db = require('../../src/db/connection');

useTestDb();
const app = buildApp();
const as = (u) => ({ Authorization: `Bearer ${u.token}` });

describe('audit: login events (success only)', () => {
  test('student login writes a login row', async () => {
    await createStudent({ nim: 'e1', password: 'e1pass123' });
    await request(app).post('/api/auth/login/student').send({ nim: 'e1', password: 'e1pass123' }).expect(200);

    const row = await db.get(`SELECT * FROM audit_logs WHERE action = 'login'`);
    expect(row.actor_type).toBe('student');
    expect(row.metadata.role).toBe('student');
  });

  test('staff login writes a login row with actor_type=staff', async () => {
    const admin = await createAdmin({ nim: 'boss', password: 'bosspass1' });
    await request(app).post('/api/auth/login/admin').send({ nim: 'boss', password: 'bosspass1' }).expect(200);

    const row = await db.get(`SELECT * FROM audit_logs WHERE action = 'login'`);
    expect(row.actor_type).toBe('staff');
    expect(row.actor_id).toBe(admin.id);
  });

  test('a failed login writes nothing', async () => {
    await createStudent({ nim: 'e3', password: 'right-pass' });
    await request(app).post('/api/auth/login/student').send({ nim: 'e3', password: 'wrong' }).expect(401);

    const row = await db.get('SELECT count(*)::int AS n FROM audit_logs');
    expect(row.n).toBe(0);
  });
});

describe('GET /api/admin/audit', () => {
  async function seedLogins(n) {
    const values = [];
    for (let i = 0; i < n; i++) {
      values.push(`('system', NULL, 'login', NULL, '{}'::jsonb, now() - interval '${i} hours')`);
    }
    await db.run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, target_user_id, metadata, created_at) VALUES ${values.join(',')}`
    );
  }

  test('requires instruktur — asisten gets 403', async () => {
    const asisten = await createAsisten();
    await request(app).get('/api/admin/audit').set(as(asisten)).expect(403);
  });

  test('instruktur reads, filters by action and target NIM, and paginates', async () => {
    const admin = await createAdmin();
    const s = await createStudent({ nim: 'target1', name: 'Target One' });
    await db.run(
      `INSERT INTO audit_logs (actor_type, actor_id, action, target_user_id, metadata)
       VALUES ('staff', $1, 'telegram_bind_staff_override', $2, '{"source":"edit_modal"}'::jsonb)`,
      [admin.id, s.id]
    );
    await seedLogins(120);

    const p1 = await request(app).get('/api/admin/audit').set(as(admin));
    expect(p1.status).toBe(200);
    expect(p1.body.rows).toHaveLength(50);
    expect(p1.body.total).toBe(121);
    expect(p1.body.pageCount).toBe(3);

    const p3 = await request(app).get('/api/admin/audit?page=3').set(as(admin));
    expect(p3.body.rows).toHaveLength(21);

    const byAction = await request(app)
      .get('/api/admin/audit?action=telegram_bind_staff_override')
      .set(as(admin));
    expect(byAction.body.total).toBe(1);
    expect(byAction.body.rows[0].target_nim).toBe('target1');

    const byNim = await request(app).get('/api/admin/audit?nim=target1').set(as(admin));
    expect(byNim.body.total).toBe(1);
  });

  test('date range filter is inclusive of both ends', async () => {
    const admin = await createAdmin();
    await db.run(`INSERT INTO audit_logs (actor_type, action, created_at) VALUES ('system','login','2026-01-10T12:00:00Z')`);
    await db.run(`INSERT INTO audit_logs (actor_type, action, created_at) VALUES ('system','login','2026-01-31T23:30:00Z')`);
    await db.run(`INSERT INTO audit_logs (actor_type, action, created_at) VALUES ('system','login','2026-02-10T12:00:00Z')`);

    const res = await request(app).get('/api/admin/audit?from=2026-01-01&to=2026-01-31').set(as(admin));
    expect(res.body.total).toBe(2);
  });
});

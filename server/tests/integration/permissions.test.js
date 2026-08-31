const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createAsisten, createStudent, createSession } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let instruktur;
let asisten;
let student;
beforeEach(async () => {
  instruktur = await createAdmin({ nim: 'dosen' }); // role: instruktur
  asisten = await createAsisten({ nim: 'ta1' });
  student = await createStudent({ nim: '20220140055' });
});

const as = (u) => ({ Authorization: `Bearer ${u.token}` });

describe('instruktur-only endpoints reject asisten (403) but allow instruktur', () => {
  const cases = [
    ['POST', '/api/admin/questions', { variant_index: 1, order_index: 1, story_text: 's' }],
    ['PATCH', '/api/admin/questions/1', { level: 'easy' }],
    ['DELETE', '/api/admin/questions/1', null],
    ['GET', '/api/admin/questions/template.xlsx', null],
    ['GET', '/api/admin/staff', null],
    ['POST', '/api/admin/staff', { nim: 'ta2', password: 'pw', role: 'asisten' }],
  ];

  test.each(cases)('%s %s -> 403 for asisten', async (method, path, body) => {
    const req = request(app)[method.toLowerCase()](path).set(as(asisten));
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(403);
  });

  test.each(cases)('%s %s -> not 403 for instruktur', async (method, path, body) => {
    const req = request(app)[method.toLowerCase()](path).set(as(instruktur));
    const res = await (body ? req.send(body) : req);
    expect(res.status).not.toBe(403);
  });

  test('a student is also rejected on an instruktur-only endpoint', async () => {
    const res = await request(app).get('/api/admin/staff').set(as(student));
    expect(res.status).toBe(403);
  });
});

describe('shared staff endpoints allow BOTH instruktur and asisten', () => {
  test('GET /api/admin/sessions -> 200 for asisten', async () => {
    const res = await request(app).get('/api/admin/sessions').set(as(asisten));
    expect(res.status).toBe(200);
  });

  test('asisten can add participants and read grades', async () => {
    const session = await createSession();
    const add = await request(app)
      .post(`/api/admin/sessions/${session.id}/participants`)
      .set(as(asisten))
      .send({ nims: ['20220140057, Andi, TI-3A'] });
    expect(add.status).toBe(201);

    const grades = await request(app)
      .get(`/api/admin/review/sessions/${session.id}/grades`)
      .set(as(asisten));
    expect(grades.status).toBe(200);
  });

  test('asisten can read the question list (needed for the review dropdown)', async () => {
    const res = await request(app).get('/api/admin/questions').set(as(asisten));
    expect(res.status).toBe(200);
  });

  test('a plain student token is rejected on a shared staff endpoint', async () => {
    const res = await request(app).get('/api/admin/sessions').set(as(student));
    expect(res.status).toBe(403);
  });
});

describe('session create/delete are instruktur-only; start stays open to asisten', () => {
  test('POST /api/admin/sessions -> 403 for asisten, 201 for instruktur', async () => {
    const denied = await request(app)
      .post('/api/admin/sessions')
      .set(as(asisten))
      .send({ name: 'Blocked' });
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .post('/api/admin/sessions')
      .set(as(instruktur))
      .send({ name: 'Allowed' });
    expect(ok.status).toBe(201);
  });

  test('DELETE /api/admin/sessions/:id -> 403 for asisten, 200 for instruktur', async () => {
    const session = await createSession();

    const denied = await request(app).delete(`/api/admin/sessions/${session.id}`).set(as(asisten));
    expect(denied.status).toBe(403);

    const ok = await request(app).delete(`/api/admin/sessions/${session.id}`).set(as(instruktur));
    expect(ok.status).toBe(200);
  });

  test('POST /api/admin/sessions/:id/start -> asisten may still start (not 403)', async () => {
    const session = await createSession();
    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(as(asisten));
    expect(res.status).not.toBe(403);
  });
});

describe('staff account management', () => {
  test('instruktur creates an asisten, then it appears in the list', async () => {
    const created = await request(app)
      .post('/api/admin/staff')
      .set(as(instruktur))
      .send({ nim: 'ta9', name: 'New TA', password: 'pw', role: 'asisten' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ nim: 'ta9', role: 'asisten' });

    const list = await request(app).get('/api/admin/staff').set(as(instruktur));
    expect(list.body.map((s) => s.nim)).toContain('ta9');
  });

  test('the newly created asisten can log in via /login/admin', async () => {
    await request(app)
      .post('/api/admin/staff')
      .set(as(instruktur))
      .send({ nim: 'ta9', name: 'New TA', password: 'pw123', role: 'asisten' });
    const login = await request(app)
      .post('/api/auth/login/admin')
      .send({ nim: 'ta9', password: 'pw123' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('asisten');
  });

  test('cannot delete the last instruktur', async () => {
    const list = await request(app).get('/api/admin/staff').set(as(instruktur));
    const onlyInstruktur = list.body.find((s) => s.role === 'instruktur');
    const res = await request(app)
      .delete(`/api/admin/staff/${onlyInstruktur.id}`)
      .set(as(instruktur));
    expect(res.status).toBe(400);
  });
});

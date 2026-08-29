const request = require('supertest');
const jwt = require('jsonwebtoken');
const buildApp = require('../../src/app');
const config = require('../../src/config');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent } = require('../helpers/factory');

useTestDb();
const app = buildApp();

describe('POST /api/auth/login/admin', () => {
  test('correct username + password -> token', async () => {
    await createAdmin({ nim: 'admin', password: 'secret123' });
    const res = await request(app).post('/api/auth/login/admin').send({ nim: 'admin', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.nim).toBe('admin');
  });

  test('wrong password -> 401 with a generic message', async () => {
    await createAdmin({ nim: 'admin', password: 'secret123' });
    const res = await request(app).post('/api/auth/login/admin').send({ nim: 'admin', password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Kredensial salah');
  });

  test('unknown admin -> same 401 status + message as wrong password (no account enumeration)', async () => {
    await createAdmin({ nim: 'admin', password: 'secret123' });
    const wrongPass = await request(app).post('/api/auth/login/admin').send({ nim: 'admin', password: 'nope' });
    const unknown = await request(app).post('/api/auth/login/admin').send({ nim: 'ghost', password: 'nope' });

    expect(unknown.status).toBe(wrongPass.status);
    expect(unknown.body).toEqual(wrongPass.body);
  });

  test('a student account cannot log in through the admin endpoint', async () => {
    await createStudent({ nim: '20220140055' });
    const res = await request(app).post('/api/auth/login/admin').send({ nim: '20220140055', password: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/login/student', () => {
  test('registered NIM + correct password -> token', async () => {
    await createStudent({ nim: '20220140055', name: 'Budi', password: '20220140055', must_change_password: true });
    const res = await request(app)
      .post('/api/auth/login/student')
      .send({ nim: '20220140055', password: '20220140055' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.name).toBe('Budi');
    expect(res.body.mustChangePassword).toBe(true);
  });

  test('unknown NIM -> 404', async () => {
    const res = await request(app).post('/api/auth/login/student').send({ nim: '00000000000', password: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NIM tidak terdaftar');
  });

  test('empty nim -> 400', async () => {
    const res = await request(app).post('/api/auth/login/student').send({});
    expect(res.status).toBe(400);
  });

  test('missing password -> 400', async () => {
    await createStudent({ nim: '20220140055', password: '20220140055' });
    const res = await request(app).post('/api/auth/login/student').send({ nim: '20220140055' });
    expect(res.status).toBe(400);
  });

  test('the server does NOT trim the NIM — surrounding whitespace fails to match (client trims)', async () => {
    await createStudent({ nim: '20220140055', password: '20220140055' });
    const res = await request(app)
      .post('/api/auth/login/student')
      .send({ nim: '  20220140055  ', password: '20220140055' });
    expect(res.status).toBe(404);
  });
});

describe('student password flow', () => {
  const NIM = '20220140055';

  test('default password (= NIM) logs in and flags mustChangePassword', async () => {
    await createStudent({ nim: NIM, password: NIM, must_change_password: true });
    const res = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: NIM });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  test('legacy NULL-hash student: password is the NIM, forced change', async () => {
    await createStudent({ nim: NIM }); // password_hash NULL, must_change_password false in the row
    const res = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: NIM });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  test('wrong password -> 401', async () => {
    await createStudent({ nim: NIM, password: NIM });
    const res = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: 'wrong-one' });
    expect(res.status).toBe(401);
  });

  test('change-password end to end', async () => {
    await createStudent({ nim: NIM, password: NIM, must_change_password: true });
    const login = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: NIM });
    const token = login.body.token;

    // gated before the change
    const blocked = await request(app).get('/api/me/history').set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MUST_CHANGE_PASSWORD');

    const changed = await request(app)
      .post('/api/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: NIM, newPassword: 'brand-new-pass' });
    expect(changed.status).toBe(200);
    expect(changed.body.token).toBeTruthy();

    // fresh token is no longer gated
    const ok = await request(app).get('/api/me/history').set('Authorization', `Bearer ${changed.body.token}`);
    expect(ok.status).toBe(200);

    // old password rejected, new password works and no longer forces a change
    const oldLogin = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: NIM });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: 'brand-new-pass' });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.mustChangePassword).toBe(false);
  });

  test('new password cannot equal the NIM, and must meet the minimum length', async () => {
    await createStudent({ nim: NIM, password: NIM, must_change_password: true });
    const { body } = await request(app).post('/api/auth/login/student').send({ nim: NIM, password: NIM });
    const auth = { Authorization: `Bearer ${body.token}` };

    const sameAsNim = await request(app)
      .post('/api/me/password')
      .set(auth)
      .send({ currentPassword: NIM, newPassword: NIM });
    expect(sameAsNim.status).toBe(400);

    const tooShort = await request(app)
      .post('/api/me/password')
      .set(auth)
      .send({ currentPassword: NIM, newPassword: 'short' });
    expect(tooShort.status).toBe(400);
  });
});

describe('auth middleware on protected endpoints', () => {
  const protectedGet = () => request(app).get('/api/admin/sessions');

  test('no token -> 401 Missing token', async () => {
    const res = await protectedGet();
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing token');
  });

  test('malformed token -> 401 Invalid or expired token (no crash)', async () => {
    const res = await protectedGet().set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  test('expired token -> 401', async () => {
    const expired = jwt.sign({ id: 1, nim: 'admin', role: 'admin' }, config.jwtSecret, { expiresIn: -10 });
    const res = await protectedGet().set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired token');
  });

  test('valid student token on an admin-only endpoint -> 403 Admin only', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const res = await protectedGet().set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin only');
  });

  test('valid admin token -> 200', async () => {
    const admin = await createAdmin();
    const res = await protectedGet().set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });
});

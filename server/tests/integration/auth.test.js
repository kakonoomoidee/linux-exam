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
  test('registered NIM -> token', async () => {
    await createStudent({ nim: '20220140055', name: 'Budi' });
    const res = await request(app).post('/api/auth/login/student').send({ nim: '20220140055' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.name).toBe('Budi');
  });

  test('unknown NIM -> 404', async () => {
    const res = await request(app).post('/api/auth/login/student').send({ nim: '00000000000' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NIM tidak terdaftar');
  });

  test('empty nim -> 400', async () => {
    const res = await request(app).post('/api/auth/login/student').send({});
    expect(res.status).toBe(400);
  });

  test('the server does NOT trim the NIM — surrounding whitespace fails to match (client trims)', async () => {
    await createStudent({ nim: '20220140055' });
    const res = await request(app).post('/api/auth/login/student').send({ nim: '  20220140055  ' });
    expect(res.status).toBe(404);
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

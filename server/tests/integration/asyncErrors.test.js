/**
 * Guards the global async-error handling (express-async-errors, wired in
 * src/app.js). Before it, a promise rejection thrown inside an `async` route
 * handler left the request hanging with no response. These tests prove:
 *   - a rejection from ANY router now surfaces as a clean 500 JSON, fast
 *   - the existing error middleware shape ({ error }) is what the client gets
 *   - normal (resolving) handlers are completely unaffected
 */
const request = require('supertest');
const buildApp = require('../../src/app');
const Session = require('../../src/models/Session');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
let errSpy;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${(await createAdmin()).token}` };
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // silence the intentional 500 logs
});
afterEach(() => errSpy.mockRestore());

async function withRejection(objPath, method, fn) {
  const orig = objPath[method];
  objPath[method] = jest.fn(() => Promise.reject(new Error('simulated failure mid-handler')));
  try {
    return await fn();
  } finally {
    objPath[method] = orig;
  }
}

describe('a mid-handler rejection becomes a 500 JSON (not a hang)', () => {
  test('GET /api/admin/sessions (adminSessions router)', async () => {
    await withRejection(Session, 'listAll', async () => {
      const res = await request(app).get('/api/admin/sessions').set(auth).timeout(3000);
      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });

  test('POST /api/cmd-log (cmdLog router — different file, same fix)', async () => {
    await withRejection(Session, 'findParticipantByToken', async () => {
      const res = await request(app)
        .post('/api/cmd-log')
        .send({ session_token: 'whatever', cmd: 'ls', exit_code: 0 })
        .timeout(3000);
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error' });
    });
  });

  test('the failing request resolves quickly rather than hanging', async () => {
    await withRejection(Session, 'listAll', async () => {
      const t0 = Date.now();
      await request(app).get('/api/admin/sessions').set(auth).timeout(3000);
      expect(Date.now() - t0).toBeLessThan(1000);
    });
  });
});

describe('regression: resolving handlers are unaffected by the global shim', () => {
  test('GET /api/health -> 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /api/admin/sessions -> 200 with the real (un-patched) model', async () => {
    await createSession({ name: 'live' });
    const res = await request(app).get('/api/admin/sessions').set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  test('POST /api/admin/sessions -> 201 (async handler, happy path)', async () => {
    const res = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'X' });
    expect(res.status).toBe(201);
  });

  test('GET /api/admin/review/sessions/:id/grades -> 200', async () => {
    const session = await createSession({ status: 'running' });
    await createParticipant({ session, user: await createStudent({ nim: '20220140055' }), variant_index: 5 });
    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/grades`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
  });

  test('an EJS page route still renders (non-API)', async () => {
    const res = await request(app).get('/exam');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<!doctype html>/i);
  });
});

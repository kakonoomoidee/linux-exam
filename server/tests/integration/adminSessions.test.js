const request = require('supertest');
const buildApp = require('../../src/app');
const Session = require('../../src/models/Session');
const timerService = require('../../src/services/timerService');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${(await createAdmin()).token}` };
});

// start-session schedules a real 10-minute setTimeout per participant; cancel them
const scheduled = new Set();
afterEach(() => {
  for (const id of scheduled) timerService.cancel(id);
  scheduled.clear();
});
async function trackTimers(sessionId) {
  for (const p of await Session.listParticipants(sessionId)) scheduled.add(p.id);
}
async function waitFor(sessionId, pred, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await Session.listParticipants(sessionId);
    if (pred(rows)) return rows;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('waitFor timed out; last state: ' + JSON.stringify(await Session.listParticipants(sessionId)));
}

describe('POST /api/admin/sessions (create)', () => {
  test('valid name -> 201, default duration 10', async () => {
    const res = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'UTS' });
    expect(res.status).toBe(201);
    expect(res.body.duration_minutes).toBe(10);
  });

  test('empty name -> 400', async () => {
    const res = await request(app).post('/api/admin/sessions').set(auth).send({ name: '' });
    expect(res.status).toBe(400);
  });

  test('duration_minutes 0 falls back to the default 10', async () => {
    const res = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'X', duration_minutes: 0 });
    expect(res.status).toBe(201);
    expect(res.body.duration_minutes).toBe(10);
  });

  test('FINDING: a negative duration is accepted unvalidated', async () => {
    const res = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'X', duration_minutes: -5 });
    expect(res.status).toBe(201);
    expect(res.body.duration_minutes).toBe(-5);
  });

  test('a DB error inside the async handler yields a 500 JSON response, not a hung request (express-async-errors)', async () => {
    // `duration_minutes: 'abc'` makes Session.create reject with a
    // SequelizeDatabaseError mid-handler. Before express-async-errors this
    // request never got a response; now it must resolve as a clean 500.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await request(app)
        .post('/api/admin/sessions')
        .set(auth)
        .send({ name: 'X', duration_minutes: 'abc' });

      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Internal server error' });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('POST /api/admin/sessions/:id/participants', () => {
  test('a new NIM auto-creates the student and derives the variant from its last digit', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/admin/sessions/${session.id}/participants`)
      .set(auth)
      .send({ nims: ['20220140057'] });
    expect(res.status).toBe(201);
    expect(res.body[0].variant_index).toBe(7);
  });

  test('adding the same NIM twice does not create a duplicate participant', async () => {
    const session = await createSession();
    const url = `/api/admin/sessions/${session.id}/participants`;
    await request(app).post(url).set(auth).send({ nims: ['20220140055'] });
    await request(app).post(url).set(auth).send({ nims: ['20220140055'] });
    expect(await Session.listParticipants(session.id)).toHaveLength(1);
  });

  test('several NIMs in one request are all added', async () => {
    const session = await createSession();
    await request(app)
      .post(`/api/admin/sessions/${session.id}/participants`)
      .set(auth)
      .send({ nims: ['20220140051', '20220140052', '20220140053'] });
    expect(await Session.listParticipants(session.id)).toHaveLength(3);
  });

  test('empty nims array -> 400', async () => {
    const session = await createSession();
    const res = await request(app).post(`/api/admin/sessions/${session.id}/participants`).set(auth).send({ nims: [] });
    expect(res.status).toBe(400);
  });

  test('unknown session -> 404', async () => {
    const res = await request(app).post('/api/admin/sessions/99999/participants').set(auth).send({ nims: ['1'] });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/sessions/:id/start', () => {
  test('a pending session provisions every participant to active and starts running', async () => {
    const session = await createSession({ status: 'pending' });
    await request(app).post(`/api/admin/sessions/${session.id}/participants`).set(auth).send({ nims: ['20220140055'] });

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(202);

    const rows = await waitFor(session.id, (ps) => ps.every((p) => p.container_status === 'active'));
    await trackTimers(session.id);
    expect(rows[0].session_token).toBeTruthy();
    expect(rows[0].ends_at).toBeTruthy();
    expect((await Session.findById(session.id)).status).toBe('running');
  });

  test('starting an already-running session where everyone is active -> 400', async () => {
    const session = await createSession({ status: 'running' });
    await createParticipant({ session, user: await createStudent({ nim: '20220140055' }), container_status: 'active' });

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(400);
  });

  test('re-starting a running session only re-provisions the stuck participants', async () => {
    const session = await createSession({ status: 'running' });
    const healthy = await createParticipant({
      session,
      user: await createStudent({ nim: '20220140055' }),
      container_status: 'active',
      container_id: 'mock-container-healthy',
    });
    await createParticipant({
      session,
      user: await createStudent({ nim: '20220140056' }),
      container_status: 'error',
      container_id: null,
    });

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/[Rr]e-provision/);

    await waitFor(session.id, (ps) => ps.every((p) => p.container_status === 'active'));
    await trackTimers(session.id);
    const healthyAfter = (await Session.listParticipants(session.id)).find((p) => p.id === healthy.id);
    expect(healthyAfter.container_id).toBe('mock-container-healthy'); // untouched
  });
});

describe('DELETE /api/admin/sessions/:id', () => {
  test('deleting a session with a live container tears it down and removes the session', async () => {
    const session = await createSession({ status: 'running' });
    await createParticipant({ session, user: await createStudent({ nim: '20220140055' }), container_status: 'active' });

    const res = await request(app).delete(`/api/admin/sessions/${session.id}`).set(auth);
    expect(res.status).toBe(200);
    expect(await Session.findById(session.id)).toBeUndefined();
  });

  test('deleting an already-ended session with no container does not error', async () => {
    const session = await createSession({ status: 'ended' });
    await createParticipant({
      session,
      user: await createStudent({ nim: '20220140055' }),
      container_status: 'destroyed',
      container_id: null,
    });
    const res = await request(app).delete(`/api/admin/sessions/${session.id}`).set(auth);
    expect(res.status).toBe(200);
  });
});

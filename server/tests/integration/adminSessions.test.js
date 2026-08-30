const request = require('supertest');
const buildApp = require('../../src/app');
const Session = require('../../src/models/Session');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${(await createAdmin()).token}` };
});


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
    expect(res.body.added[0].variant_index).toBe(7);
  });

  test('a row with an invalid kelas is reported in skipped, not added', async () => {
    const session = await createSession();
    const res = await request(app)
      .post(`/api/admin/sessions/${session.id}/participants`)
      .set(auth)
      .send({ nims: [{ nim: '20220140058', name: 'X', kelas: 'TI-3A' }, { nim: '20220140059', name: 'Y', kelas: 'c' }] });
    expect(res.status).toBe(201);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].nim).toBe('20220140058');
    expect(res.body.added).toHaveLength(1);
    const rows = await Session.listParticipants(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kelas).toBe('C'); // 'c' normalized to uppercase
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
  test('a pending session goes running with a join code and provisions nobody (lazy join)', async () => {
    const session = await createSession({ status: 'pending' });
    await request(app).post(`/api/admin/sessions/${session.id}/participants`).set(auth).send({ nims: ['20220140055'] });

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(202);

    // give any (unwanted) provisioning a chance to happen, then assert it didn't
    await new Promise((r) => setTimeout(r, 150));
    const fresh = await Session.findById(session.id);
    expect(fresh.status).toBe('running');
    expect(fresh.join_code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
    const rows = await Session.listParticipants(session.id);
    expect(rows.every((p) => p.container_status === 'not_started')).toBe(true);
  });

  test('starting an already-running session is idempotent — returns the same join code, provisions nobody', async () => {
    const session = await createSession({ status: 'running' });
    const p = await createParticipant({
      session,
      user: await createStudent({ nim: '20220140055' }),
      container_status: 'not_started',
      container_id: null,
    });
    const first = await Session.ensureJoinCode(session.id);

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.join_code).toBe(first.join_code);

    await new Promise((r) => setTimeout(r, 150));
    const after = await Session.getParticipant(p.id);
    expect(after.container_status).toBe('not_started'); // never force-provisioned
  });

  test('an ended session cannot be restarted — 409, status and started_at unchanged', async () => {
    const startedAt = new Date('2020-01-01T00:00:00Z').toISOString();
    const session = await createSession({ status: 'ended', started_at: startedAt });

    const res = await request(app).post(`/api/admin/sessions/${session.id}/start`).set(auth);
    expect(res.status).toBe(409);

    await new Promise((r) => setTimeout(r, 150));
    const fresh = await Session.findById(session.id);
    expect(fresh.status).toBe('ended');
    expect(new Date(fresh.started_at).toISOString()).toBe(startedAt);
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

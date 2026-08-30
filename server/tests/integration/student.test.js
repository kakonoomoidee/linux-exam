const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent, createSession, createParticipant, createQuestion } = require('../helpers/factory');
const Session = require('../../src/models/Session');
const { Submission } = require('../../src/models/Submission');

useTestDb();
const app = buildApp();

async function waitFor(fn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('GET /api/me/active-participant', () => {
  test('returns the running session with questions, submissions and a positive remainingMs', async () => {
    const student = await createStudent({ nim: '20220140055' });
    // remainingMs is now session-wide: started_at + duration_minutes, not participant.ends_at.
    const session = await createSession({
      status: 'running',
      started_at: new Date(Date.now() - 60 * 1000).toISOString(), // started 1 min ago
      duration_minutes: 5,
    });
    await createParticipant({ session, user: student, variant_index: 5 });
    await createQuestion({ variant_index: 5, order_index: 1, story_text: 'q one' });

    const res = await request(app)
      .get('/api/me/active-participant')
      .set('Authorization', `Bearer ${student.token}`);

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).not.toHaveProperty('accepted_patterns'); // withheld from client
    expect(Array.isArray(res.body.submissions)).toBe(true);
    // ~4 min left (5 min session, started 1 min ago)
    expect(res.body.remainingMs).toBeGreaterThan(3 * 60000);
    expect(res.body.remainingMs).toBeLessThanOrEqual(4 * 60000);
  });

  test('404 when the student has no active participant', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const res = await request(app)
      .get('/api/me/active-participant')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(404);
  });

  test('a participant whose container has ended is not "active"', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const session = await createSession({ status: 'running' });
    await createParticipant({ session, user: student, container_status: 'ended' });

    const res = await request(app)
      .get('/api/me/active-participant')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(404);
  });

  test('requires a token', async () => {
    const res = await request(app).get('/api/me/active-participant');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/me/join', () => {
  const bearer = (u) => ({ Authorization: `Bearer ${u.token}` });

  async function runningSessionWithCode() {
    const session = await createSession({ status: 'running' });
    return Session.ensureJoinCode(session.id); // -> row with .join_code
  }

  test('wrong code -> generic 403', async () => {
    const student = await createStudent({ nim: '20220140055' });
    await runningSessionWithCode();
    const res = await request(app).post('/api/me/join').set(bearer(student)).send({ code: 'ZZZZZZ' });
    expect(res.status).toBe(403);
  });

  test('right code but not on the roster -> identical 403 to a wrong code', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const session = await runningSessionWithCode();
    // student is NOT added as a participant

    const wrong = await request(app).post('/api/me/join').set(bearer(student)).send({ code: 'ZZZZZZ' });
    const notOnRoster = await request(app)
      .post('/api/me/join')
      .set(bearer(student))
      .send({ code: session.join_code });

    expect(notOnRoster.status).toBe(wrong.status);
    expect(notOnRoster.body).toEqual(wrong.body);
  });

  test('code for an already-ended session -> generic 403 even if on the roster', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const ended = await createSession({ status: 'ended' });
    const withCode = await Session.ensureJoinCode(ended.id);
    await createParticipant({ session: ended, user: student, container_status: 'not_started' });

    const res = await request(app)
      .post('/api/me/join')
      .set(bearer(student))
      .send({ code: withCode.join_code });
    expect(res.status).toBe(403);
  });

  test('code exists but the session is still pending (not started) -> generic 403', async () => {
    // join codes are minted at Session.create() now, so a code can be valid
    // while the session has not been started — the status='running' gate holds.
    const student = await createStudent({ nim: '20220140055' });
    const pending = await createSession({ status: 'pending' });
    const withCode = await Session.ensureJoinCode(pending.id);
    await createParticipant({ session: pending, user: student, container_status: 'not_started' });

    const res = await request(app)
      .post('/api/me/join')
      .set(bearer(student))
      .send({ code: withCode.join_code });
    expect(res.status).toBe(403);
  });

  test('running session whose session-wide deadline has passed -> 403 "Waktu ujian sudah berakhir"', async () => {
    const student = await createStudent({ nim: '20220140055' });
    // started 20 min ago, 10 min session => deadline is 10 min in the past
    const session = await createSession({
      status: 'running',
      started_at: new Date(Date.now() - 20 * 60000).toISOString(),
      duration_minutes: 10,
    });
    const withCode = await Session.ensureJoinCode(session.id);
    await createParticipant({ session, user: student, container_status: 'not_started' });

    const res = await request(app)
      .post('/api/me/join')
      .set(bearer(student))
      .send({ code: withCode.join_code });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Waktu ujian sudah berakhir/);
  });

  test('right code + on the roster + running -> 202 and the student gets provisioned', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const session = await runningSessionWithCode();
    const participant = await createParticipant({
      session,
      user: student,
      container_status: 'not_started',
      container_id: null,
      ends_at: null,
    });

    const res = await request(app)
      .post('/api/me/join')
      .set(bearer(student))
      .send({ code: session.join_code });
    expect(res.status).toBe(202);

    const provisioned = await waitFor(async () => {
      const p = await Session.getParticipant(participant.id);
      return p.container_status === 'active';
    });
    expect(provisioned).toBe(true);
  });
});

describe('GET /api/me/history', () => {
  test('returns only the authenticated student\'s own sessions and score', async () => {
    const alice = await createStudent({ nim: '20220140001', name: 'Alice' });
    const bob = await createStudent({ nim: '20220140002', name: 'Bob' });
    const session = await createSession({ status: 'ended', name: 'UTS' });
    const q = await createQuestion({ variant_index: 5, order_index: 1 });

    const pa = await createParticipant({ session, user: alice, container_status: 'ended' });
    const pb = await createParticipant({ session, user: bob, container_status: 'ended' });
    await Submission.markAutoResult(pa.id, q.id, { auto_result: 'pass', auto_score: 5 });
    await Submission.markAutoResult(pb.id, q.id, { auto_result: 'pass', auto_score: 9 });

    const res = await request(app)
      .get('/api/me/history')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].session_name).toBe('UTS');
    expect(Number(res.body[0].score)).toBe(5); // Alice's, never Bob's 9
  });

  test('requires a token', async () => {
    const res = await request(app).get('/api/me/history');
    expect(res.status).toBe(401);
  });
});

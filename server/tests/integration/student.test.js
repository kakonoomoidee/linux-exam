const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createStudent, createSession, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
const app = buildApp();

describe('GET /api/me/active-participant', () => {
  test('returns the running session with questions, submissions and a positive remainingMs', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const session = await createSession({ status: 'running' });
    await createParticipant({
      session,
      user: student,
      variant_index: 5,
      ends_at: new Date(Date.now() + 5 * 60000).toISOString(),
    });
    await createQuestion({ variant_index: 5, order_index: 1, story_text: 'q one' });

    const res = await request(app)
      .get('/api/me/active-participant')
      .set('Authorization', `Bearer ${student.token}`);

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0]).not.toHaveProperty('accepted_patterns'); // withheld from client
    expect(Array.isArray(res.body.submissions)).toBe(true);
    expect(res.body.remainingMs).toBeGreaterThan(0);
    expect(res.body.remainingMs).toBeLessThanOrEqual(5 * 60000);
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

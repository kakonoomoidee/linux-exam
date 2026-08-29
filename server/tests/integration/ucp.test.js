const request = require('supertest');
const buildApp = require('../../src/app');
const Question = require('../../src/models/Question');
const { Submission } = require('../../src/models/Submission');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${(await createAdmin()).token}` };
});

describe('UCP split — a session only ever serves its own UCP', () => {
  test('same (variant_index, order_index) can exist once per UCP', async () => {
    const a = await createQuestion({ variant_index: 4, order_index: 1, ucp: 1, story_text: 'ucp1 q' });
    const b = await createQuestion({ variant_index: 4, order_index: 1, ucp: 2, story_text: 'ucp2 q' });
    expect(a.id).not.toBe(b.id);

    expect((await Question.listForVariantIndex(4, 1)).map((q) => q.story_text)).toEqual(['ucp1 q']);
    expect((await Question.listForVariantIndex(4, 2)).map((q) => q.story_text)).toEqual(['ucp2 q']);
    expect((await Question.listForVariantIndex(4)).map((q) => q.story_text).sort()).toEqual(['ucp1 q', 'ucp2 q']);
  });

  test('student payload for a UCP 1 session excludes a same-variant UCP 2 question', async () => {
    const student = await createStudent({ nim: '20220140054' });
    const session = await createSession({ status: 'running', ucp: 1 });
    await createParticipant({ session, user: student, variant_index: 4 });
    await createQuestion({ variant_index: 4, order_index: 1, ucp: 1, story_text: 'served' });
    await createQuestion({ variant_index: 4, order_index: 2, ucp: 2, story_text: 'hidden' });

    const res = await request(app)
      .get('/api/me/active-participant')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q) => q.story_text)).toEqual(['served']);
  });

  test('cmd-log grading in a UCP 1 session ignores a UCP 2 pattern at the same variant', async () => {
    const student = await createStudent({ nim: '20220140054' });
    const session = await createSession({ status: 'running', ucp: 1 });
    const participant = await createParticipant({
      session,
      user: student,
      variant_index: 4,
      container_status: 'active',
    });
    // UCP 2 question whose pattern the student's command matches — must NOT score.
    const ucp2 = await createQuestion({
      variant_index: 4,
      order_index: 1,
      ucp: 2,
      check_type: 'command_match',
      accepted_patterns: ['^whoami$'],
    });

    const res = await request(app)
      .post('/api/cmd-log')
      .send({ session_token: participant.session_token, cmd: 'whoami', exit_code: 0 });
    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(false);
    expect(await Submission.get(participant.id, ucp2.id)).toBeUndefined();
  });

  test('POST /admin/sessions rejects an explicit bad ucp but defaults a missing one to 1', async () => {
    const bad = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'X', ucp: 5 });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'X' });
    expect(ok.status).toBe(201);
    expect(ok.body.ucp).toBe(1);

    const two = await request(app).post('/api/admin/sessions').set(auth).send({ name: 'Y', ucp: 2 });
    expect(two.body.ucp).toBe(2);
  });
});

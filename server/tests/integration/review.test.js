const request = require('supertest');
const buildApp = require('../../src/app');
const db = require('../../src/db/connection');
const { Submission, CommandLog } = require('../../src/models/Submission');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
let session;
let admin;
beforeEach(async () => {
  admin = await createAdmin();
  auth = { Authorization: `Bearer ${admin.token}` };
  session = await createSession({ status: 'running' });
});

describe('GET /api/admin/review/sessions/:id/grades', () => {
  test('per-participant total mixes overridden final_score with auto_score, and counts are accurate', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const participant = await createParticipant({ session, user: student, variant_index: 5 });
    const q1 = await createQuestion({ variant_index: 5, order_index: 1, point: 2 });
    const q2 = await createQuestion({ variant_index: 5, order_index: 2, point: 4 });

    await Submission.markAutoResult(participant.id, q1.id, { auto_result: 'pass', auto_score: 2 });
    await Submission.markAutoResult(participant.id, q2.id, { auto_result: 'pass', auto_score: 4 });
    await Submission.overrideScore(participant.id, q2.id, 3, admin.id); // reviewer bumped it down to 3

    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/grades`).set(auth);
    expect(res.status).toBe(200);
    const [row] = res.body.rows;
    expect(row).toMatchObject({
      solvedCount: 2, // both auto-passed
      reviewedCount: 1, // only q2 has a final_score
      totalQuestions: 2,
      total: 5, // q1 auto 2 + q2 final 3
      maxTotal: 6, // 2 + 4
    });
  });
});

describe('GET /api/admin/review/sessions/:id/transcript', () => {
  test('commands interleave by time; is_match flags only the command that scored; unmatched -> question_id null', async () => {
    const a = await createParticipant({ session, user: await createStudent({ nim: '20220140055' }), variant_index: 5 });
    const b = await createParticipant({ session, user: await createStudent({ nim: '20220140056' }), variant_index: 5 });
    const q = await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });

    // controlled timestamps: A@t0, B@t1, A@t2
    const mk = (pid, qid, cmd, offsetSec) =>
      db.run(
        `INSERT INTO command_logs (participant_id, question_id, raw_command, normalized_command, exit_code, created_at)
         VALUES ($1,$2,$3,$3,0, now() + ($4 || ' seconds')::interval) RETURNING *`,
        [pid, qid, cmd, String(offsetSec)]
      );
    const aWin = await mk(a.id, q.id, 'ls', 0);
    await mk(b.id, null, 'whoami', 1);
    await mk(a.id, null, 'pwd', 2);
    await Submission.markAutoResult(a.id, q.id, { auto_result: 'pass', auto_score: 1, matched_command_log_id: aWin.id });

    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/transcript`).set(auth);
    expect(res.status).toBe(200);
    const { entries } = res.body;

    expect(entries.map((e) => e.raw_command)).toEqual(['ls', 'whoami', 'pwd']); // time order
    expect(entries.find((e) => e.raw_command === 'ls').is_match).toBe(true);
    expect(entries.find((e) => e.raw_command === 'pwd').is_match).toBeFalsy();
    expect(entries.find((e) => e.raw_command === 'whoami').question_id).toBeNull();
  });
});

describe('PATCH /api/admin/review/submissions/:participantId/:questionId', () => {
  let participant;
  let q;
  beforeEach(async () => {
    participant = await createParticipant({ session, user: await createStudent({ nim: '20220140055' }), variant_index: 5 });
    q = await createQuestion({ variant_index: 5, order_index: 1, point: 4 });
    await Submission.markAutoResult(participant.id, q.id, { auto_result: 'fail', auto_score: 0 });
  });

  test.each([
    [1, 4],
    [0.5, 2],
    [0, 0],
  ])('fraction %p is stored as final_score %p (fraction * point)', async (fraction, expected) => {
    const res = await request(app)
      .patch(`/api/admin/review/submissions/${participant.id}/${q.id}`)
      .set(auth)
      .send({ fraction });
    expect(res.status).toBe(200);
    const sub = await Submission.get(participant.id, q.id);
    expect(sub.final_score).toBe(expected);
  });

  test('a fraction outside the allowed set is rejected', async () => {
    const res = await request(app)
      .patch(`/api/admin/review/submissions/${participant.id}/${q.id}`)
      .set(auth)
      .send({ fraction: 0.3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fraction/);
  });
});

describe('GET /api/admin/review/sessions/:id/export.csv', () => {
  test('emits a CSV with the header row and decimal scores from overrides', async () => {
    const participant = await createParticipant({ session, user: await createStudent({ nim: '20220140055', name: 'Budi' }), variant_index: 5 });
    const q = await createQuestion({ variant_index: 5, order_index: 1, point: 4 });
    await Submission.markAutoResult(participant.id, q.id, { auto_result: 'pass', auto_score: 4 });
    await Submission.overrideScore(participant.id, q.id, 1, admin.id); // fraction 0.25 of 4

    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/export.csv?token=${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('nim,nama,kelas,total_nilai,nilai_per_soal');
    expect(lines[1]).toBe('20220140055,Budi,,1,1'); // kelas empty for this student
  });

  test('the CSV export accepts the token via query string (no Authorization header)', async () => {
    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/export.csv?token=${admin.token}`);
    expect(res.status).toBe(200);
  });

  test('the CSV export with no token -> 401', async () => {
    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/export.csv`);
    expect(res.status).toBe(401);
  });
});

describe('Per Kelas review — GET /api/admin/review/sessions/:id/kelas[/:kelas]', () => {
  test('lists the distinct kelas present in the session', async () => {
    await createParticipant({ session, user: await createStudent({ nim: '20220140051', kelas: 'A' }), variant_index: 1 });
    await createParticipant({ session, user: await createStudent({ nim: '20220140052', kelas: 'C' }), variant_index: 2 });
    await createParticipant({ session, user: await createStudent({ nim: '20220140053', kelas: null }), variant_index: 3 });

    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/kelas`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.kelas).toEqual(['A', 'C']);
  });

  test('groups every question the kelas was served by variant, with a row per student (no-shows included)', async () => {
    // session is UCP 1 (factory default). Kelas A spans two variants here.
    const s1 = await createStudent({ nim: '20220140051', name: 'Andi', kelas: 'A' });
    const s2 = await createStudent({ nim: '20220140052', name: 'Bella', kelas: 'A' });
    const p1 = await createParticipant({ session, user: s1, variant_index: 1 });
    await createParticipant({ session, user: s2, variant_index: 2 });

    const v1q1 = await createQuestion({ variant_index: 1, order_index: 1, point: 2, story_text: 'v1 q1' });
    await createQuestion({ variant_index: 1, order_index: 2, point: 1, story_text: 'v1 q2' });
    await createQuestion({ variant_index: 2, order_index: 1, point: 3, story_text: 'v2 q1' });
    // a UCP 2 question at the same variant/order must not leak in
    await createQuestion({ variant_index: 1, order_index: 1, ucp: 2, story_text: 'ucp2 leak' });

    await Submission.markAutoResult(p1.id, v1q1.id, { auto_result: 'pass', auto_score: 2 });

    const res = await request(app).get(`/api/admin/review/sessions/${session.id}/kelas/A`).set(auth);
    expect(res.status).toBe(200);

    const variants = res.body.groups.map((g) => g.variant_index).sort();
    expect(variants).toEqual([1, 2]);

    const g1 = res.body.groups.find((g) => g.variant_index === 1);
    expect(g1.questions.map((q) => q.story_text)).toEqual(['v1 q1', 'v1 q2']); // ordered, no ucp2 leak
    const q1 = g1.questions[0];
    expect(q1.submissions.map((x) => x.nim)).toEqual(['20220140051']); // only the variant-1 kelas-A student
    expect(q1.submissions[0].auto_result).toBe('pass');

    // the variant-1 student never attempted q2 -> row still present, null result
    expect(g1.questions[1].submissions[0].auto_result).toBeNull();

    const g2 = res.body.groups.find((g) => g.variant_index === 2);
    expect(g2.questions[0].submissions.map((x) => x.nim)).toEqual(['20220140052']);
  });
});

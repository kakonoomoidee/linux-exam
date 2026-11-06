const request = require('supertest');
const XLSX = require('xlsx');
const buildApp = require('../../src/app');
const db = require('../../src/db/connection');
const { Submission } = require('../../src/models/Submission');
const { useTestDb } = require('../helpers/db');
const {
  createAdmin, createAsisten, createStudent, createSession, createParticipant, createQuestion,
} = require('../helpers/factory');

useTestDb();
const app = buildApp();
const as = (u) => ({ Authorization: `Bearer ${u.token}` });

let instruktur;
let asisten;
let student;
let session;
let p1; // 9999000010, variant 0
let p2; // 9999000020, variant 0
let q1;
let q2;
let otherVariantQ;

async function logCmd(participantId, raw, exit = 0, questionId = null) {
  return db.run(
    `INSERT INTO command_logs (participant_id, question_id, raw_command, normalized_command, exit_code)
     VALUES ($1, $2, $3, $3, $4) RETURNING *`,
    [participantId, questionId, raw, exit]
  );
}

beforeEach(async () => {
  instruktur = await createAdmin({ nim: 'dosen' });
  asisten = await createAsisten({ nim: 'ta1', name: 'Asisten Satu' });
  student = await createStudent({ nim: '9999000099', name: 'Not Staff' });
  session = await createSession({ name: 'Demo Sesi', status: 'ended', started_at: '2026-11-03T01:00:00Z' });
  q1 = await createQuestion({ variant_index: 0, order_index: 1, point: 20, accepted_patterns: ['^ls\\s+Music$'],
    story_text: 'Tampilkan isi Music' });
  q2 = await createQuestion({ variant_index: 0, order_index: 2, point: 20, accepted_patterns: ['^pwd$'] });
  otherVariantQ = await createQuestion({ variant_index: 1, order_index: 1, point: 20 });

  p1 = await createParticipant({ session, user: await createStudent({ nim: '9999000010', name: 'Andi', kelas: 'A' }), variant_index: 0, container_status: 'ended' });
  p2 = await createParticipant({ session, user: await createStudent({ nim: '9999000020', name: 'Bunga', kelas: 'B' }), variant_index: 0, container_status: 'ended' });

  const win = await logCmd(p1.id, 'ls Music', 0, q1.id);
  await Submission.markAutoResult(p1.id, q1.id, { auto_result: 'pass', auto_score: 20, matched_command_log_id: win.id });
  await logCmd(p2.id, 'ls Music/'); // near miss: trailing slash
  await logCmd(p2.id, 'whoami');
});

describe('permissions: students never reach Review Nilai v2', () => {
  const routes = () => [
    ['get', '/api/admin/grading/sessions'],
    ['get', `/api/admin/grading/sessions/${session.id}`],
    ['get', `/api/admin/grading/participants/${p1.id}`],
    ['put', `/api/admin/grading/participants/${p1.id}/questions/${q1.id}/correction`, { percent: 50 }],
    ['delete', `/api/admin/grading/participants/${p1.id}/questions/${q1.id}/correction`],
    ['get', `/api/admin/grading/sessions/${session.id}/export.csv`],
    ['get', `/api/admin/grading/sessions/${session.id}/export.xlsx`],
    ['get', `/api/admin/questions/${q1.id}/answer-key`],
    ['put', `/api/admin/questions/${q1.id}/sample-answers`, { sample_answers: ['ls Music'] }],
  ];

  test('student token -> 403 on every route', async () => {
    for (const [method, path, body] of routes()) {
      const res = await request(app)[method](path).set(as(student)).send(body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
  });

  test('student token in ?token= (download links) -> 403 as well', async () => {
    const res = await request(app).get(`/api/admin/grading/sessions/${session.id}/export.csv?token=${student.token}`);
    expect(res.status).toBe(403);
  });

  test('no token -> 401', async () => {
    for (const [method, path, body] of routes()) {
      const res = await request(app)[method](path).send(body);
      expect(res.status).toBe(401);
    }
  });

  test('asisten can view, correct and export (not 403)', async () => {
    for (const [method, path, body] of routes().slice(0, 8)) {
      const res = await request(app)[method](path).set(as(asisten)).send(body);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  test('editing sample answers is instruktur-only', async () => {
    const path = `/api/admin/questions/${q1.id}/sample-answers`;
    expect((await request(app).put(path).set(as(asisten)).send({ sample_answers: ['ls Music'] })).status).toBe(403);
    expect((await request(app).put(path).set(as(instruktur)).send({ sample_answers: ['ls Music'] })).status).toBe(200);
  });
});

describe('levels 1-3', () => {
  test('session list: participants, average final grade, pending near-misses', async () => {
    const res = await request(app).get('/api/admin/grading/sessions').set(as(asisten));
    expect(res.status).toBe(200);
    expect(res.body.sessions[0]).toMatchObject({ id: session.id, participantCount: 2, averageGrade: 25, nearMissPending: 1 });
  });

  test('session overview: one row per student with auto/final totals and near-miss count + summary', async () => {
    const res = await request(app).get(`/api/admin/grading/sessions/${session.id}`).set(as(asisten));
    expect(res.status).toBe(200);
    const bunga = res.body.students.find((s) => s.nim === '9999000020');
    expect(bunga).toMatchObject({ kelas: 'B', variantIndex: 0, autoTotal: 0, finalTotal: 0, maxTotal: 40,
      nearMissPending: 1, status: 'pending', questionCount: 2 });
    expect(res.body.summary.perQuestion.find((q) => q.questionId === q1.id)).toMatchObject({ correct: 1, participants: 2, nearMiss: 1 });
  });

  test('participant detail: every variant question (even unattempted), key and detection', async () => {
    const res = await request(app).get(`/api/admin/grading/participants/${p2.id}`).set(as(asisten));
    expect(res.status).toBe(200);
    expect(res.body.questions.map((q) => q.question.id)).toEqual([q1.id, q2.id]);
    const [first] = res.body.questions;
    expect(first.detection).toMatchObject({ label: 'near_miss', reasons: ['trailing_slash'], suggestedPercent: 100 });
    expect(first.key.patterns[0].examples).toEqual(['ls Music']);
    expect(res.body.commands.map((c) => c.raw_command)).toEqual(['ls Music/', 'whoami']);
  });

  test('unknown ids -> 404, malformed ids -> 400', async () => {
    expect((await request(app).get('/api/admin/grading/sessions/999999').set(as(asisten))).status).toBe(404);
    expect((await request(app).get('/api/admin/grading/participants/999999').set(as(asisten))).status).toBe(404);
    expect((await request(app).get('/api/admin/grading/participants/abc').set(as(asisten))).status).toBe(400);
  });
});

describe('PUT/DELETE correction', () => {
  const path = () => `/api/admin/grading/participants/${p2.id}/questions/${q1.id}/correction`;

  test('saves percent of point + note + who/when, and writes an audit row', async () => {
    const res = await request(app).put(path()).set(as(asisten)).send({ percent: 75, note: '  beda slash  ' });
    expect(res.status).toBe(200);
    const sub = await Submission.get(p2.id, q1.id);
    expect(sub).toMatchObject({ final_score: 15, review_note: 'beda slash', reviewed_by: asisten.id });
    expect(sub.reviewed_at).not.toBeNull();

    const audit = await db.get("SELECT * FROM audit_logs WHERE action = 'grade_correction'");
    expect(audit).toMatchObject({ actor_id: asisten.id, metadata: expect.objectContaining({ percent: 75, final_score: 15, question_id: q1.id }) });

    const detail = await request(app).get(`/api/admin/grading/participants/${p2.id}`).set(as(instruktur));
    expect(detail.body.questions[0].submission).toMatchObject({ final_score: 15, finalPercent: 75, reviewer_name: 'Asisten Satu', review_note: 'beda slash' });
    expect(detail.body.student).toMatchObject({ finalTotal: 15, finalGrade: 37.5, nearMissPending: 0, status: 'partial' });
  });

  test('0% and 100% overrides are allowed (0 still counts as reviewed)', async () => {
    await request(app).put(path()).set(as(asisten)).send({ percent: 100 }).expect(200);
    expect((await Submission.get(p2.id, q1.id)).final_score).toBe(20);
    const zero = `/api/admin/grading/participants/${p1.id}/questions/${q1.id}/correction`;
    await request(app).put(zero).set(as(asisten)).send({ percent: 0 }).expect(200);
    expect((await Submission.get(p1.id, q1.id)).final_score).toBe(0);
  });

  test.each([[30], ['50'], [null], [undefined], [0.5]])('percent %p -> 400, nothing written', async (percent) => {
    const res = await request(app).put(path()).set(as(asisten)).send({ percent });
    expect(res.status).toBe(400);
    expect(await Submission.get(p2.id, q1.id)).toBeUndefined();
  });

  test('note longer than 1000 chars -> 400', async () => {
    const res = await request(app).put(path()).set(as(asisten)).send({ percent: 50, note: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  test("a question outside the participant's variant -> 404 (no stray submission)", async () => {
    const res = await request(app)
      .put(`/api/admin/grading/participants/${p2.id}/questions/${otherVariantQ.id}/correction`)
      .set(as(asisten)).send({ percent: 100 });
    expect(res.status).toBe(404);
    expect(await Submission.get(p2.id, otherVariantQ.id)).toBeUndefined();
  });

  test('DELETE removes the correction so the auto score counts again', async () => {
    await request(app).put(path()).set(as(asisten)).send({ percent: 50, note: 'x' }).expect(200);
    await request(app).delete(path()).set(as(asisten)).expect(200);
    expect(await Submission.get(p2.id, q1.id)).toMatchObject({ final_score: null, review_note: null, reviewed_by: null });
  });
});

describe('export', () => {
  test('CSV: BOM, file name, NIM order, final = correction else auto, same numbers as the page', async () => {
    await request(app).put(`/api/admin/grading/participants/${p2.id}/questions/${q1.id}/correction`)
      .set(as(asisten)).send({ percent: 50 }).expect(200);
    const res = await request(app).get(`/api/admin/grading/sessions/${session.id}/export.csv?token=${asisten.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="nilai_demo-sesi_2026-11-03.csv"');
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('﻿No,NIM,Nama,Kelas,Varian,Soal 1,Soal 2,Skor auto total,Skor final total,Skor maksimum,Nilai akhir (0-100),Status koreksi');
    expect(lines[1]).toBe('1,9999000010,Andi,A,0,20,0,20,20,40,50,Belum dikoreksi');
    expect(lines[2]).toBe('2,9999000020,Bunga,B,0,10,0,0,10,40,25,Sebagian');

    const page = await request(app).get(`/api/admin/grading/sessions/${session.id}`).set(as(asisten));
    const pageGrades = page.body.students.sort((a, b) => a.nim.localeCompare(b.nim)).map((s) => String(s.finalGrade));
    expect(lines.slice(1, 3).map((l) => l.split(',')[10])).toEqual(pageGrades);
  });

  test('detail CSV lists every question with the correction trail', async () => {
    await request(app).put(`/api/admin/grading/participants/${p2.id}/questions/${q1.id}/correction`)
      .set(as(asisten)).send({ percent: 50, note: 'catatan' }).expect(200);
    const res = await request(app).get(`/api/admin/grading/sessions/${session.id}/export.csv?detail=1&token=${asisten.token}`);
    expect(res.headers['content-disposition']).toContain('nilai_demo-sesi_2026-11-03_detail.csv');
    const row = res.text.split('\r\n').find((l) => l.startsWith('9999000020') && l.includes('ls Music/'));
    expect(row).toContain('unmatched,0,50,10,near_miss,catatan,Asisten Satu'); // row created by the correction
  });

  test('XLSX has Nilai + Detail sheets', async () => {
    const res = await request(app).get(`/api/admin/grading/sessions/${session.id}/export.xlsx?token=${asisten.token}`)
      .buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Nilai', 'Detail']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Nilai, { header: 1 })).toHaveLength(3);
  });
});

describe('sample answers (readable key)', () => {
  test('valid answers are stored and show up in the key; invalid ones are listed with a 400', async () => {
    const path = `/api/admin/questions/${q1.id}/sample-answers`;
    const bad = await request(app).put(path).set(as(instruktur)).send({ sample_answers: ['ls Music', 'ls -la'] });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual([{ answer: 'ls -la', error: 'no_pattern_match' }]);

    const ok = await request(app).put(path).set(as(instruktur)).send({ sample_answers: ['ls Music', 'ls  "Music"'] });
    expect(ok.status).toBe(200);
    expect(ok.body.key.patterns[0]).toMatchObject({ examples: ['ls Music', 'ls  "Music"'], derived: false });

    const key = await request(app).get(`/api/admin/questions/${q1.id}/answer-key`).set(as(asisten));
    expect(JSON.parse(key.body.question.sample_answers)).toEqual(['ls Music', 'ls  "Music"']);
  });

  test('the downloadable template ships grader-valid sample_answers', async () => {
    const res = await request(app).get(`/api/admin/questions/template.xlsx?token=${instruktur.token}`)
      .buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = XLSX.read(res.body, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const { validateSampleAnswers } = require('../../src/services/answerKeyService');
    for (const r of rows) {
      const answers = String(r.sample_answers).split('\n').filter(Boolean);
      const patterns = String(r.accepted_patterns).split('|').map((s) => s.trim()).filter(Boolean);
      expect(answers.length).toBeGreaterThan(0);
      expect(validateSampleAnswers({ check_type: r.check_type, accepted_patterns: patterns }, answers).errors).toEqual([]);
    }
  });
});

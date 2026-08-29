const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const XLSX = require('xlsx');
const request = require('supertest');
const buildApp = require('../../src/app');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let auth;
beforeEach(async () => {
  auth = { Authorization: `Bearer ${(await createAdmin()).token}` };
});

const tmp = [];
afterEach(() => {
  while (tmp.length) fs.rmSync(tmp.pop(), { force: true });
});
function workbookBuffer(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  const p = path.join(os.tmpdir(), `aq-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  tmp.push(p);
  return p;
}

describe('POST /api/admin/questions/import', () => {
  test('imports an uploaded workbook and reports created/total', async () => {
    const file = workbookBuffer('Variant 4', [
      { order: 1, story: 'first', point: 1, accepted_patterns: '^ls$' },
      { order: 2, story: 'second', point: 2, accepted_patterns: '^pwd$' },
    ]);
    const res = await request(app).post('/api/admin/questions/import').set(auth).attach('file', file);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 2, created: 2 });
  });

  test('missing file -> 400', async () => {
    const res = await request(app).post('/api/admin/questions/import').set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file wajib diupload/);
  });

  test('requires an admin token', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const res = await request(app)
      .post('/api/admin/questions/import')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/questions/template.xlsx', () => {
  test('returns a parseable xlsx with the documented header columns', async () => {
    const res = await request(app)
      .get('/api/admin/questions/template.xlsx')
      .set(auth)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);

    const wb = XLSX.read(res.body, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0];
    expect(headers).toEqual([
      'ucp',
      'order',
      'story_id',
      'story_en',
      'point',
      'level',
      'check_type',
      'accepted_patterns',
      'state_checker',
    ]);
    // at least one example row
    expect(XLSX.utils.sheet_to_json(sheet).length).toBeGreaterThanOrEqual(2);
  });
});

describe('question CRUD', () => {
  test('create -> patch -> delete round-trip', async () => {
    const created = await request(app)
      .post('/api/admin/questions')
      .set(auth)
      .send({
        variant_index: 3,
        order_index: 1,
        story_text: 'tampilkan tanggal',
        story_text_en: 'print the date',
        point: 2,
        level: 'hard',
        check_type: 'command_match',
        accepted_patterns: ['^date$'],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      story_text: 'tampilkan tanggal',
      story_text_en: 'print the date',
      level: 'hard',
      point: 2,
    });

    const id = created.body.id;
    const patched = await request(app)
      .patch(`/api/admin/questions/${id}`)
      .set(auth)
      .send({ level: 'easy', story_text_en: 'show the date' });
    expect(patched.status).toBe(200);
    expect(patched.body.level).toBe('easy');
    expect(patched.body.story_text_en).toBe('show the date');

    const del = await request(app).delete(`/api/admin/questions/${id}`).set(auth);
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/admin/questions/variant/3').set(auth);
    expect(after.body).toHaveLength(0);
  });

  test('create without story_text -> 400', async () => {
    const res = await request(app)
      .post('/api/admin/questions')
      .set(auth)
      .send({ variant_index: 3, order_index: 1 });
    expect(res.status).toBe(400);
  });

  test('patch / delete a missing question -> 404', async () => {
    expect((await request(app).patch('/api/admin/questions/999999').set(auth).send({ level: 'easy' })).status).toBe(404);
    expect((await request(app).delete('/api/admin/questions/999999').set(auth)).status).toBe(404);
  });

  test('an unknown level on create is normalised to medium', async () => {
    const res = await request(app)
      .post('/api/admin/questions')
      .set(auth)
      .send({ variant_index: 2, order_index: 9, story_text: 's', level: 'spicy' });
    expect(res.status).toBe(201);
    expect(res.body.level).toBe('medium');
  });
});

describe('GET /api/admin/questions', () => {
  test('/variant/:variantIndex returns just that variant, /  returns all variants', async () => {
    await request(app).post('/api/admin/questions/import').set(auth).attach(
      'file',
      workbookBuffer('Variant 4', [{ order: 1, story: 'v4 q', accepted_patterns: '^ls$' }])
    );
    await request(app).post('/api/admin/questions/import').set(auth).attach(
      'file',
      workbookBuffer('Variant 7', [{ order: 1, story: 'v7 q', accepted_patterns: '^ls$' }])
    );

    const v4 = await request(app).get('/api/admin/questions/variant/4').set(auth);
    expect(v4.body).toHaveLength(1);
    expect(v4.body[0].story_text).toBe('v4 q');

    const all = await request(app).get('/api/admin/questions').set(auth);
    expect(all.body.length).toBe(2);
  });
});

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

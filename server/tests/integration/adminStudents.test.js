const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const XLSX = require('xlsx');
const request = require('supertest');
const buildApp = require('../../src/app');
const User = require('../../src/models/User');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createAsisten, createStudent } = require('../helpers/factory');

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
function rosterFile(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Mahasiswa');
  const p = path.join(os.tmpdir(), `roster-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, p);
  tmp.push(p);
  return p;
}

describe('POST /api/admin/students/import', () => {
  test('creates missing students and reports counts; new rows get NIM as password + forced change', async () => {
    const file = rosterFile([
      { NIM: '20220140051', Nama: 'Andi', Kelas: 'A' },
      { NIM: '20220140052', Nama: 'Bella', Kelas: 'b' },
    ]);
    const res = await request(app).post('/api/admin/students/import').set(auth).attach('file', file);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalRows: 2, created: 2, backfilled: 0 });
    expect(res.body.errors).toHaveLength(0);

    const andi = await User.findByNim('20220140051');
    expect(andi.kelas).toBe('A');
    expect(andi.role).toBe('student');
    expect(andi.must_change_password).toBe(true);
    expect((await User.findByNim('20220140052')).kelas).toBe('B'); // 'b' normalized
  });

  test('only backfills name/kelas where the existing value is NULL — never overwrites', async () => {
    await createStudent({ nim: '20220140055', name: 'Set By Staff', kelas: 'C' });
    await User.create({ nim: '20220140056', name: null }); // no kelas yet

    const file = rosterFile([
      { NIM: '20220140055', Nama: 'From Excel', Kelas: 'D' }, // must be ignored
      { NIM: '20220140056', Nama: 'Rina', Kelas: 'E' }, // backfilled
    ]);
    const res = await request(app).post('/api/admin/students/import').set(auth).attach('file', file);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, backfilled: 1 });

    expect((await User.findByNim('20220140055')).name).toBe('Set By Staff');
    expect((await User.findByNim('20220140055')).kelas).toBe('C');
    expect((await User.findByNim('20220140056')).name).toBe('Rina');
    expect((await User.findByNim('20220140056')).kelas).toBe('E');
  });

  test('rows with an invalid kelas are reported with their NIM, not silently dropped', async () => {
    const file = rosterFile([
      { NIM: '20220140051', Nama: 'Andi', Kelas: 'TI_3A' },
      { NIM: '', Nama: 'No NIM', Kelas: 'A' },
      { NIM: '20220140052', Nama: 'Bella', Kelas: 'A' },
    ]);
    const res = await request(app).post('/api/admin/students/import').set(auth).attach('file', file);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors.map((e) => e.error).join(' ')).toMatch(/format kelas tidak valid/);
    expect(res.body.errors.some((e) => e.nim === '20220140051')).toBe(true);
    expect(await User.findByNim('20220140051')).toBeUndefined();
  });

  test('asisten may import (same tier as adding session participants)', async () => {
    const asisten = await createAsisten({ nim: 'ta1' });
    const file = rosterFile([{ NIM: '20220140051', Nama: 'Andi', Kelas: 'A' }]);
    const res = await request(app)
      .post('/api/admin/students/import')
      .set('Authorization', `Bearer ${asisten.token}`)
      .attach('file', file);
    expect(res.status).toBe(200);
  });

  test('a plain student token is rejected', async () => {
    const student = await createStudent({ nim: '20220140055' });
    const res = await request(app)
      .post('/api/admin/students/import')
      .set('Authorization', `Bearer ${student.token}`);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/students/:id', () => {
  test('updates kelas after normalization', async () => {
    const s = await createStudent({ nim: '20220140055' });
    const res = await request(app).patch(`/api/admin/students/${s.id}`).set(auth).send({ kelas: 'd' });
    expect(res.status).toBe(200);
    expect(res.body.kelas).toBe('D');
  });

  test('rejects an invalid kelas', async () => {
    const s = await createStudent({ nim: '20220140055', kelas: 'A' });
    const res = await request(app).patch(`/api/admin/students/${s.id}`).set(auth).send({ kelas: 'TI_3A' });
    expect(res.status).toBe(400);
    expect((await User.findByNim('20220140055')).kelas).toBe('A'); // unchanged
  });

  test('accepts an ad-hoc class code beyond A–F', async () => {
    const s = await createStudent({ nim: '20220140055', kelas: 'A' });
    const res = await request(app).patch(`/api/admin/students/${s.id}`).set(auth).send({ kelas: 'ti-1a' });
    expect(res.status).toBe(200);
    expect(res.body.kelas).toBe('TI-1A');
  });

  test('empty kelas clears it', async () => {
    const s = await createStudent({ nim: '20220140055', kelas: 'A' });
    const res = await request(app).patch(`/api/admin/students/${s.id}`).set(auth).send({ kelas: '' });
    expect(res.status).toBe(200);
    expect(res.body.kelas).toBeNull();
  });

  test('404 for a non-student id', async () => {
    const staff = await createAdmin({ nim: 'dosen2' });
    const res = await request(app).patch(`/api/admin/students/${staff.id}`).set(auth).send({ kelas: 'A' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/students', () => {
  test('lists students ordered by kelas (nulls last) then NIM', async () => {
    await createStudent({ nim: '20220140059', kelas: 'C' });
    await createStudent({ nim: '20220140051', kelas: 'A' });
    await createStudent({ nim: '20220140030', kelas: null });
    await createStudent({ nim: '20220140040', kelas: 'A' });

    const res = await request(app).get('/api/admin/students').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.nim)).toEqual([
      '20220140040',
      '20220140051',
      '20220140059',
      '20220140030',
    ]);
  });
});

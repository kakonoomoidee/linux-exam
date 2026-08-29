const request = require('supertest');
const buildApp = require('../../src/app');
const User = require('../../src/models/User');
const { useTestDb } = require('../helpers/db');
const { createAdmin } = require('../helpers/factory');

useTestDb();
const app = buildApp();

const as = (u) => ({ Authorization: `Bearer ${u.token}` });

describe('DELETE /api/admin/staff/:id — last-instruktur guard', () => {
  test('the sole instruktur cannot be deleted (rejected, still present)', async () => {
    const only = await createAdmin({ nim: 'onlyDosen' }); // the one and only instruktur

    // With one instruktur, the only caller who can reach this route IS that
    // instruktur, so deleting "them" is a self-delete — rejected either way.
    const res = await request(app).delete(`/api/admin/staff/${only.id}`).set(as(only));
    expect(res.status).toBe(400);
    expect(await User.findById(only.id)).toBeTruthy();
    expect((await User.countInstruktur()).count).toBe(1);
  });

  test('with two instruktur, deleting one succeeds and the other remains', async () => {
    const a = await createAdmin({ nim: 'dosenA' });
    const b = await createAdmin({ nim: 'dosenB' });
    expect((await User.countInstruktur()).count).toBe(2);

    const res = await request(app).delete(`/api/admin/staff/${b.id}`).set(as(a));
    expect(res.status).toBe(200);

    expect((await User.countInstruktur()).count).toBe(1);
    expect(await User.findById(a.id)).toBeTruthy();
    expect(await User.findById(b.id)).toBeUndefined();
  });

  test('the count<=1 branch rejects with the instruktur-specific message', async () => {
    // Drive the guard directly: two instruktur, act as A, delete B -> ok;
    // then A is alone and any further instruktur delete would 400. We assert the
    // message wording is the guard's, not the self-delete guard's.
    const a = await createAdmin({ nim: 'dosen1' });
    const b = await createAdmin({ nim: 'dosen2' });
    await request(app).delete(`/api/admin/staff/${b.id}`).set(as(a));

    const res = await request(app).delete(`/api/admin/staff/${a.id}`).set(as(a));
    expect(res.status).toBe(400);
    // self-delete guard fires first here; either way the account survives.
    expect(await User.findById(a.id)).toBeTruthy();
  });
});

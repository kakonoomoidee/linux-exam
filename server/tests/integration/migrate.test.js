const db = require('../../src/db/connection');
const migrate = require('../../src/db/migrate');
const { useTestDb } = require('../helpers/db');

useTestDb();

// The kelas CHECK constraint normally makes bad values un-insertable, so to
// exercise the one-time normalization we drop it, seed legacy free-text, then
// let migrate() salvage + re-add the constraint.
async function dropKelasCheck() {
  await db.sequelize.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kelas_chk');
  await db.sequelize.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kelas_code_chk');
}

describe('migrate: one-time kelas normalization', () => {
  test('salvages the last A–F letter, nulls the unsalvageable, and is idempotent', async () => {
    await dropKelasCheck();
    await db.run(`INSERT INTO users (nim, name, role, kelas) VALUES
      ('20220140001', 'A', 'student', 'TI-3A'),
      ('20220140002', 'B', 'student', 'kelas c'),
      ('20220140003', 'C', 'student', 'D'),
      ('20220140004', 'D', 'student', 'X9'),
      ('20220140005', 'E', 'student', NULL)`);

    await migrate();

    const rows = await db.all(
      "SELECT nim, kelas FROM users WHERE nim LIKE '202201400%' ORDER BY nim"
    );
    const byNim = Object.fromEntries(rows.map((r) => [r.nim, r.kelas]));
    expect(byNim['20220140001']).toBe('A');
    expect(byNim['20220140002']).toBe('C');
    expect(byNim['20220140003']).toBe('D');
    expect(byNim['20220140004']).toBeNull(); // 'X9' can't be salvaged
    expect(byNim['20220140005']).toBeNull();

    // constraint is back
    const [chk] = await db.all(
      "SELECT 1 FROM pg_constraint WHERE conname = 'users_kelas_chk'"
    );
    expect(chk).toBeTruthy();

    // second run changes nothing (would throw if it tried to write an invalid value)
    await migrate();
    const after = await db.all("SELECT nim, kelas FROM users WHERE nim LIKE '202201400%' ORDER BY nim");
    expect(Object.fromEntries(after.map((r) => [r.nim, r.kelas]))).toEqual(byNim);
  });

  test('the re-added CHECK constraint rejects a non-A–F kelas', async () => {
    await expect(
      db.run("INSERT INTO users (nim, name, role, kelas) VALUES ('20220140099', 'Z', 'student', 'TI-3A')")
    ).rejects.toThrow();
  });
});

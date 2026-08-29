const fs = require('fs');
const path = require('path');
const db = require('./connection');
const { sequelize } = db;
const config = require('../config');
const { hash } = require('../lib/password');
const { salvageKelas } = require('../lib/kelas');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await sequelize.query(schema); // multi-statement, no bind params

  // One-time role rename: 'admin' was the only staff role before the 3-role
  // model (instruktur / asisten / student). Promote legacy admins to the
  // top tier. Idempotent — a second boot matches zero rows.
  const [, promo] = await sequelize.query("UPDATE users SET role = 'instruktur' WHERE role = 'admin'");
  if (promo && promo.rowCount) {
    console.log(`[migrate] promoted ${promo.rowCount} legacy admin row(s) -> instruktur`);
  }

  // ensure variant rows 0-9 always exist
  for (let i = 0; i <= 9; i++) {
    await sequelize.query(
      'INSERT INTO question_variants (variant_index) VALUES ($1) ON CONFLICT (variant_index) DO NOTHING',
      { bind: [i] }
    );
  }

  // One-time kelas normalization: kelas used to be free text ('TI-3A', 'b', ...).
  // It's now a single letter A–F. Salvage the last alphabetic char; anything that
  // doesn't yield an A–F letter is nulled and printed so an instruktur can fix it
  // by hand. Idempotent — after one pass every value is A–F or NULL, so salvage is
  // a fixpoint and a second boot changes zero rows.
  const kelasRows = await db.all('SELECT id, nim, kelas FROM users WHERE kelas IS NOT NULL');
  let kelasFixed = 0;
  const kelasNulled = [];
  for (const row of kelasRows) {
    const salvaged = salvageKelas(row.kelas);
    if (salvaged === row.kelas) continue;
    await db.run('UPDATE users SET kelas = $1 WHERE id = $2', [salvaged, row.id]);
    kelasFixed++;
    if (salvaged === null) kelasNulled.push({ nim: row.nim, original: row.kelas });
  }
  if (kelasFixed) {
    console.log(`[migrate] normalized ${kelasFixed} kelas value(s) to single-letter A–F`);
  }
  if (kelasNulled.length) {
    console.log(`[migrate] ${kelasNulled.length} kelas value(s) could not be salvaged and were set to NULL — fix manually:`);
    for (const r of kelasNulled) console.log(`[migrate]   NIM ${r.nim}: "${r.original}" -> NULL`);
  }

  // Guarded DDL (idempotent). ADD CONSTRAINT IF NOT EXISTS isn't valid Postgres,
  // so each is wrapped in a DO block that checks pg_constraint first.
  //  1. users.kelas must be a single letter A–F (NULL passes automatically).
  //  2. questions unique key gains `ucp` so UCP 1 and UCP 2 can both number
  //     their questions 1..N within the same variant.
  await sequelize.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_kelas_chk') THEN
        ALTER TABLE users ADD CONSTRAINT users_kelas_chk CHECK (kelas ~ '^[A-F]$');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_variant_id_order_index_key') THEN
        ALTER TABLE questions DROP CONSTRAINT questions_variant_id_order_index_key;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_variant_ucp_order_key') THEN
        ALTER TABLE questions ADD CONSTRAINT questions_variant_ucp_order_key UNIQUE (variant_id, ucp, order_index);
      END IF;
    END $$;
  `);

  // Admin account — upserted every boot from ADMIN_USER / ADMIN_PASSWORD.
  await sequelize.query(
    `INSERT INTO users (nim, name, role, password_hash) VALUES ($1, $2, 'instruktur', $3)
     ON CONFLICT (nim) DO UPDATE SET role = 'instruktur', password_hash = EXCLUDED.password_hash`,
    { bind: [config.adminUser, 'Administrator', await hash(config.adminPassword)] }
  );

  console.log('[migrate] schema applied');
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = migrate;

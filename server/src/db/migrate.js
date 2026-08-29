const fs = require('fs');
const path = require('path');
const { sequelize } = require('./connection');
const config = require('../config');
const { hash } = require('../lib/password');

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

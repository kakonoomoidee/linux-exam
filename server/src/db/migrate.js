const fs = require('fs');
const path = require('path');
const { sequelize } = require('./connection');
const config = require('../config');
const { hash } = require('../lib/password');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await sequelize.query(schema); // multi-statement, no bind params

  // ensure variant rows 0-9 always exist
  for (let i = 0; i <= 9; i++) {
    await sequelize.query(
      'INSERT INTO question_variants (variant_index) VALUES ($1) ON CONFLICT (variant_index) DO NOTHING',
      { bind: [i] }
    );
  }

  // Admin account — upserted every boot from ADMIN_USER / ADMIN_PASSWORD.
  await sequelize.query(
    `INSERT INTO users (nim, name, role, password_hash) VALUES ($1, $2, 'admin', $3)
     ON CONFLICT (nim) DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash`,
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

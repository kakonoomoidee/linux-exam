// Runs once for the whole test run (not per file): make sure the *_test
// database exists, then apply the schema a single time.
const assert = require('node:assert');
const { Client } = require('pg');

module.exports = async function globalSetup() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || 'postgres://tekser:tekser@localhost:5434/tekser_test';
  assert.match(process.env.DATABASE_URL, /_test(\?|$)/, 'tests require a *_test database');

  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);

  // connect to the default maintenance DB to create the test DB if needed
  const admin = new Client({
    host: url.hostname,
    port: url.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE ${JSON.stringify(dbName).replace(/"/g, '')}`);
  await admin.end();

  const { sequelize } = require('../../src/db/connection');

  // Test DB only, and disposable — drop durability for speed. Scoped to this
  // database, so the dev DB in the same Postgres container is untouched.
  await sequelize.query(`ALTER DATABASE ${JSON.stringify(dbName).replace(/"/g, '')} SET synchronous_commit = off`);

  const migrate = require('../../src/db/migrate');
  await migrate();
  await sequelize.close();
};

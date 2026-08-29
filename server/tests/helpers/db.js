/**
 * Test database lifecycle. Assumes DATABASE_URL already points at a dedicated
 * `*_test` database (set in tests/helpers/env.js) and hard-refuses anything
 * else so a misconfigured run can never wipe real data.
 *
 * Only test files that touch the DB call useTestDb() — pure unit tests skip it
 * and pay no migrate/truncate cost.
 */
const assert = require('node:assert');

assert.match(
  process.env.DATABASE_URL || '',
  /_test(\?|$)/,
  `refusing to run tests against a non-_test database: ${process.env.DATABASE_URL}`
);

const { sequelize } = require('../../src/db/connection');

// schema is applied once by tests/helpers/global-setup.js; nothing to do here.
async function setup() {}

// Wipe every per-test table (question_variants — the 10 seeded rows — is left
// intact). DELETE + sequence reset instead of `TRUNCATE ... RESTART IDENTITY`:
// TRUNCATE fsyncs the truncated relation files, which on a Docker-volume
// Postgres under WSL2 costs 1-40s per call and blows jest's beforeEach hook
// timeout; DELETE on these tiny test tables is ~1ms. Tables are listed
// child-before-parent so the FKs are satisfied without CASCADE.
async function truncateAll() {
  await sequelize.query(`
    DELETE FROM submissions;
    DELETE FROM command_logs;
    DELETE FROM session_participants;
    DELETE FROM sessions;
    DELETE FROM questions;
    DELETE FROM users;
    ALTER SEQUENCE command_logs_id_seq RESTART WITH 1;
    ALTER SEQUENCE submissions_id_seq RESTART WITH 1;
    ALTER SEQUENCE session_participants_id_seq RESTART WITH 1;
    ALTER SEQUENCE sessions_id_seq RESTART WITH 1;
    ALTER SEQUENCE questions_id_seq RESTART WITH 1;
    ALTER SEQUENCE users_id_seq RESTART WITH 1;
  `);
}

async function close() {
  await sequelize.close();
}

/** Register the standard beforeAll/beforeEach/afterAll for a DB-backed suite. */
function useTestDb() {
  beforeAll(setup);
  beforeEach(truncateAll);
  afterAll(close);
}

module.exports = { setup, truncateAll, close, useTestDb, sequelize };

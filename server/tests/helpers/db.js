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

// question_variants (10 seeded rows) is deliberately left intact between tests.
async function truncateAll() {
  await sequelize.query(
    `TRUNCATE command_logs, submissions, session_participants, sessions, questions, users
     RESTART IDENTITY CASCADE`
  );
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

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/helpers/env.js'],
  globalSetup: '<rootDir>/tests/helpers/global-setup.js',

  // Integration tests share one Postgres database and truncate it in
  // beforeEach — they must not run in parallel.
  maxWorkers: 1,
  testTimeout: 15000,
  // one test deliberately leaves a request hanging (documents an Express 4
  // async-error bug); another opens a Socket.IO server. Force a clean exit.
  forceExit: true,

  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/server.js', // just wires migrate()+listen(); never imported by tests
    '!src/db/migrate.js', // exercised by tests/helpers/global-setup.js in a separate process
    '!src/scripts/**',
  ],
  coverageReporters: ['text', 'text-summary'],
};

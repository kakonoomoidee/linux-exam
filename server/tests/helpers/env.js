// Runs before the test framework and before any src/ module is required, so
// config/index.js picks these up. A dedicated *_test database is mandatory —
// tests/helpers/db.js refuses anything else.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://tekser:tekser@localhost:5434/tekser_test';
process.env.CONTAINER_DRIVER = 'mock';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';

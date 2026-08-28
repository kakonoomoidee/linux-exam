const assert = require('assert');
const { hash, verify } = require('./password');

(async () => {
  const h = await hash('admin123');
  assert.ok(h.startsWith('$2'), 'bcrypt hash format');
  assert.strictEqual(await verify('admin123', h), true, 'correct password verifies');
  assert.strictEqual(await verify('wrong', h), false, 'wrong password rejected');
  assert.strictEqual(await verify('x', null), false, 'null hash rejected, no throw');
  console.log('password.test.js ok');
})();

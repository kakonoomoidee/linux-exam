const buildApp = require('../../src/app');
const examService = require('../../src/services/examService');
const Session = require('../../src/models/Session');
const { MockDriver } = require('../../src/services/containerDrivers');
const { useTestDb } = require('../helpers/db');
const { createSession, createStudent, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
buildApp(); // wire routes/services (attachIo etc. are optional here)

const patches = [];
afterEach(() => {
  while (patches.length) {
    const { obj, key, orig } = patches.pop();
    obj[key] = orig;
  }
});
function patch(obj, key, fn) {
  patches.push({ obj, key, orig: obj[key] });
  obj[key] = fn;
}

async function runningSessionWithParticipants(n) {
  const session = await createSession({
    status: 'running',
    started_at: new Date(Date.now() - 60 * 60000).toISOString(), // deadline long past
    duration_minutes: 10,
  });
  await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });
  const participants = [];
  for (let i = 0; i < n; i++) {
    const student = await createStudent({ nim: `2022014005${i}` });
    participants.push(
      await createParticipant({ session, user: student, variant_index: 5, container_status: 'active' })
    );
  }
  return { session, participants };
}

test('endSessionExam ends every active participant and marks the session ended', async () => {
  const { session, participants } = await runningSessionWithParticipants(3);

  await examService.endSessionExam(session.id);

  for (const p of participants) {
    expect((await Session.getParticipant(p.id)).container_status).toBe('ended');
  }
  expect((await Session.findById(session.id)).status).toBe('ended');
});

test('REGRESSION: one participant whose teardown throws does not block the others', async () => {
  const { session, participants } = await runningSessionWithParticipants(3);

  // every destroy throws — endParticipant try/catches teardown, and
  // endSessionExam uses allSettled, so the whole batch must still complete.
  patch(MockDriver.prototype, 'destroy', async () => {
    throw new Error('simulated docker daemon failure during mass teardown');
  });

  await examService.endSessionExam(session.id);

  for (const p of participants) {
    expect((await Session.getParticipant(p.id)).container_status).toBe('ended');
  }
  expect((await Session.findById(session.id)).status).toBe('ended');
});

test('endSessionExam skips participants that are not active (idempotent re-run)', async () => {
  const { session, participants } = await runningSessionWithParticipants(2);

  await examService.endSessionExam(session.id);
  // second run is a no-op — nothing is 'active' any more
  await examService.endSessionExam(session.id);

  for (const p of participants) {
    expect((await Session.getParticipant(p.id)).container_status).toBe('ended');
  }
});

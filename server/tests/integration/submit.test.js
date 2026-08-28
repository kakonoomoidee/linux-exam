const request = require('supertest');
const buildApp = require('../../src/app');
const Session = require('../../src/models/Session');
const db = require('../../src/db/connection');
const { MockDriver } = require('../../src/services/containerDrivers');
const { useTestDb } = require('../helpers/db');
const { createSession, createStudent, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
const app = buildApp();

let student;
let participant;

beforeEach(async () => {
  const session = await createSession({ status: 'running' });
  student = await createStudent({ nim: '20220140055' });
  participant = await createParticipant({ session, user: student, variant_index: 5 });
});

// each test restores whatever it patched
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

const submit = () => request(app).post('/api/me/submit').set('Authorization', `Bearer ${student.token}`);
const freshParticipant = () => Session.getParticipant(participant.id);

test('a normal submit responds quickly and ends the participant', async () => {
  await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });

  const t0 = Date.now();
  const res = await submit();
  const elapsed = Date.now() - t0;

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'Submitted' });
  expect(elapsed).toBeLessThan(500); // regression guard for the submit-hang bug
  expect((await freshParticipant()).container_status).toBe('ended');
});

test('submitting a second time returns a clean 400, not a crash or a re-run', async () => {
  const first = await submit();
  expect(first.status).toBe(200);

  const second = await submit();
  expect(second.status).toBe(400);
  expect(second.body.error).toMatch(/Tidak ada sesi aktif/);
});

test('submitting with no active participant -> 400 (not 500)', async () => {
  await Session.updateParticipant(participant.id, { container_status: 'destroyed' });
  const res = await submit();
  expect(res.status).toBe(400);
});

describe('end-of-session state checks', () => {
  test('a "both" question runs its state_checker; default mock output is not PASS -> fail', async () => {
    const q = await createQuestion({
      variant_index: 5,
      order_index: 1,
      check_type: 'both',
      point: 5,
      accepted_patterns: ['^nope$'],
      state_checker_script: 'echo something',
    });
    const execSpy = jest.fn(async () => ({ exitCode: 0, output: '(mock output)' }));
    patch(MockDriver.prototype, 'exec', execSpy);

    await submit();

    expect(execSpy).toHaveBeenCalled();
    const [sub] = await db.all(
      'SELECT * FROM submissions WHERE participant_id = $1 AND question_id = $2',
      [participant.id, q.id]
    );
    expect(sub).toMatchObject({ auto_result: 'fail', auto_score: 0 });
  });

  test('a "both" question whose state_checker prints PASS is awarded its full points', async () => {
    const q = await createQuestion({
      variant_index: 5,
      order_index: 1,
      check_type: 'both',
      point: 5,
      accepted_patterns: ['^nope$'],
      state_checker_script: 'run check',
    });
    patch(MockDriver.prototype, 'exec', async () => ({ exitCode: 0, output: 'checking...\nPASS\n' }));

    await submit();

    const [sub] = await db.all(
      'SELECT * FROM submissions WHERE participant_id = $1 AND question_id = $2',
      [participant.id, q.id]
    );
    expect(sub).toMatchObject({ auto_result: 'pass', auto_score: 5 });
  });
});

test('REGRESSION: a teardown failure still lets the submit succeed and marks the participant ended', async () => {
  await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });
  patch(MockDriver.prototype, 'destroy', async () => {
    throw new Error('simulated docker daemon failure during teardown');
  });

  const res = await submit();

  expect(res.status).toBe(200);
  expect((await freshParticipant()).container_status).toBe('ended');
});

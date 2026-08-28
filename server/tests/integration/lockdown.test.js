const { EventEmitter } = require('node:events');
const { startServer } = require('../helpers/server');
const { connect, waitFor, neverFires } = require('../helpers/sioclient');
const lockService = require('../../src/services/lockService');
const { MockDriver } = require('../../src/services/containerDrivers');
const Session = require('../../src/models/Session');
const { useTestDb } = require('../helpers/db');
const { createAdmin, createStudent, createSession, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let srv;
let adminSock;
let studentSock;
let admin;
let session;

beforeEach(async () => {
  lockService._resetState();
  srv = await startServer();
  admin = await createAdmin();
  session = await createSession({ status: 'running' });
  await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });

  adminSock = connect(srv.url);
  await adminSock.ready();
  adminSock.emitEvent('admin:join', { token: admin.token });
  await sleep(50);
});

const origAttach = MockDriver.prototype.attachInteractive;
afterEach(async () => {
  studentSock && studentSock.close();
  adminSock && adminSock.close();
  await srv.close();
  MockDriver.prototype.attachInteractive = origAttach;
});

async function joinAsStudent(participant) {
  studentSock = connect(srv.url);
  await studentSock.ready();
  studentSock.emitEvent('student:join', { sessionToken: participant.session_token });
  await sleep(150); // let the async join handler resolve
}

test('a violation from an ended participant generates no code and no admin alert', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'ended',
    variant_index: 5,
  });
  await joinAsStudent(participant);

  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  const noAlert = await neverFires(adminSock, 'admin:violation', 700);
  expect(noAlert).toBe(true);

  const row = await Session.getParticipant(participant.id);
  expect(row.lock_code).toBeNull();
  expect(row.violation_count).toBe(0);
  expect(lockService.isLocked(participant.id)).toBe(false);
});

test('admin force-unlock clears the lock exactly like a correct code would', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'active',
    variant_index: 5,
  });
  await joinAsStudent(participant);

  const locked = waitFor(studentSock, 'exam:locked');
  const alerted = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  await Promise.all([locked, alerted]);
  expect(lockService.isLocked(participant.id)).toBe(true);

  const unlocked = waitFor(studentSock, 'exam:unlocked');
  const res = await fetch(`${srv.url}/api/admin/review/participants/${participant.id}/force-unlock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(res.status).toBe(200);
  await unlocked;

  expect(lockService.isLocked(participant.id)).toBe(false);
  const row = await Session.getParticipant(participant.id);
  expect(row.locked_at).toBeNull();
  expect(row.lock_code).toBeNull();
});

test('the server drops terminal:input while a participant is locked, and resumes after unlock', async () => {
  // give the terminal bridge a fake stream so we can observe writes
  const fakeStream = Object.assign(new EventEmitter(), { write: jest.fn(), end: jest.fn() });
  MockDriver.prototype.attachInteractive = async () => fakeStream;

  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'active',
    variant_index: 5,
  });
  await joinAsStudent(participant);
  await sleep(50);

  // not locked yet -> input reaches the container
  studentSock.emitEvent('terminal:input', 'echo before\n');
  await sleep(80);
  expect(fakeStream.write).toHaveBeenCalledWith('echo before\n');
  fakeStream.write.mockClear();

  // lock, then try to type
  const locked = waitFor(studentSock, 'exam:locked');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  await locked;

  studentSock.emitEvent('terminal:input', 'echo WHILE_LOCKED\n');
  await sleep(120);
  expect(fakeStream.write).not.toHaveBeenCalled();

  // unlock via force-unlock, then input flows again
  const unlocked = waitFor(studentSock, 'exam:unlocked');
  await fetch(`${srv.url}/api/admin/review/participants/${participant.id}/force-unlock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  await unlocked;
  await sleep(30);

  studentSock.emitEvent('terminal:input', 'echo after\n');
  await sleep(80);
  expect(fakeStream.write).toHaveBeenCalledWith('echo after\n');
});

test('a second violation before unlock overrides the code and invalidates the first', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'active',
    variant_index: 5,
  });
  await joinAsStudent(participant);

  let p = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  const first = await p;

  p = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  const second = await p;

  expect(second.code).not.toBe(first.code);
  expect(second.violationCount).toBe(2);

  const row = await Session.getParticipant(participant.id);
  expect(String(row.lock_code)).toBe(String(second.code));
  expect(row.violation_count).toBe(2);

  // the old code no longer works, the new one does
  const failed = waitFor(studentSock, 'exam:unlock_failed');
  studentSock.emitEvent('student:unlock', { code: String(first.code) });
  await failed;

  const ok = waitFor(studentSock, 'exam:unlocked');
  studentSock.emitEvent('student:unlock', { code: String(second.code) });
  await ok;
  expect(lockService.isLocked(participant.id)).toBe(false);
});

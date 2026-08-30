const { EventEmitter } = require('node:events');
const { startServer } = require('../helpers/server');
const { connect, waitFor, neverFires } = require('../helpers/sioclient');
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

test('a tab-switch is recorded and pushed to the dashboard as an audit event, with no lock', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'active',
    variant_index: 5,
  });
  await joinAsStudent(participant);

  // the student is never locked
  const everLocked = neverFires(studentSock, 'exam:locked', 600);

  let alert = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  const first = await alert;
  expect(first.violationCount).toBe(1);
  expect(first).not.toHaveProperty('code'); // no unlock code is minted anymore
  expect(first.timestamp).toBeTruthy();

  alert = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  const second = await alert;
  expect(second.violationCount).toBe(2); // increments by exactly 1 per report

  expect(await everLocked).toBe(true);

  const row = await Session.getParticipant(participant.id);
  expect(row.violation_count).toBe(2);
  expect(row.last_violation_at).toBeTruthy();
});

test('a violation from an ended participant is ignored', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'ended',
    variant_index: 5,
  });
  await joinAsStudent(participant);

  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  expect(await neverFires(adminSock, 'admin:violation', 700)).toBe(true);

  const row = await Session.getParticipant(participant.id);
  expect(row.violation_count).toBe(0);
});

test('terminal:input is never suppressed — before or after a tab-switch', async () => {
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

  studentSock.emitEvent('terminal:input', 'echo before\n');
  await sleep(80);
  expect(fakeStream.write).toHaveBeenCalledWith('echo before\n');
  fakeStream.write.mockClear();

  const alerted = waitFor(adminSock, 'admin:violation');
  studentSock.emitEvent('student:violation', { sessionToken: participant.session_token });
  await alerted;

  studentSock.emitEvent('terminal:input', 'echo after\n');
  await sleep(120);
  expect(fakeStream.write).toHaveBeenCalledWith('echo after\n');
});

test('the force-unlock route is gone', async () => {
  const participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    container_status: 'active',
    variant_index: 5,
  });
  const res = await fetch(`${srv.url}/api/admin/review/participants/${participant.id}/force-unlock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(res.status).toBe(404);
});

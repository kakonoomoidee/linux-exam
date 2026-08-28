const request = require('supertest');
const buildApp = require('../../src/app');
const db = require('../../src/db/connection');
const { useTestDb } = require('../helpers/db');
const { createSession, createStudent, createParticipant, createQuestion } = require('../helpers/factory');

useTestDb();
const app = buildApp();

const post = (payload) => request(app).post('/api/cmd-log').send(payload);
const logsFor = (pid) => db.all('SELECT * FROM command_logs WHERE participant_id = $1 ORDER BY id', [pid]);
const subsFor = (pid) => db.all('SELECT * FROM submissions WHERE participant_id = $1', [pid]);

let participant;
beforeEach(async () => {
  const session = await createSession({ status: 'running' });
  participant = await createParticipant({
    session,
    user: await createStudent({ nim: '20220140055' }),
    variant_index: 5,
  });
});

describe('scoring', () => {
  test('a matching command with exit 0 marks the question passed with its full point value', async () => {
    const q = await createQuestion({ variant_index: 5, order_index: 1, point: 3, accepted_patterns: ['^cat mahasiswa\\.txt$'] });

    const res = await post({ session_token: participant.session_token, cmd: 'cat mahasiswa.txt', exit_code: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, matched: true });

    const [sub] = await subsFor(participant.id);
    expect(sub).toMatchObject({ question_id: q.id, auto_result: 'pass', auto_score: 3 });
    const [log] = await logsFor(participant.id);
    expect(sub.matched_command_log_id).toBe(log.id);
  });

  test('a matching command with a non-zero exit code scores nothing but is still logged', async () => {
    await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });

    const res = await post({ session_token: participant.session_token, cmd: 'ls', exit_code: 2 });
    expect(res.body.matched).toBe(false);

    expect(await subsFor(participant.id)).toHaveLength(0);
    expect(await logsFor(participant.id)).toHaveLength(1);
  });

  test('a command that matches no question is logged with question_id NULL and changes no submission', async () => {
    await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });

    const res = await post({ session_token: participant.session_token, cmd: 'whoami', exit_code: 0 });
    expect(res.body.matched).toBe(false);

    const logs = await logsFor(participant.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].question_id).toBeNull();
    expect(await subsFor(participant.id)).toHaveLength(0);
  });

  test('re-running the winning command for an already-passed question does not double up the submission', async () => {
    const q = await createQuestion({ variant_index: 5, order_index: 1, point: 2, accepted_patterns: ['^ls$'] });
    await post({ session_token: participant.session_token, cmd: 'ls', exit_code: 0 });
    await post({ session_token: participant.session_token, cmd: 'ls', exit_code: 0 });

    const subs = await db.all('SELECT * FROM submissions WHERE participant_id = $1 AND question_id = $2', [participant.id, q.id]);
    expect(subs).toHaveLength(1);
    expect(subs[0].auto_result).toBe('pass');
  });

  test('when one command matches two questions, the lower order_index wins', async () => {
    const q1 = await createQuestion({ variant_index: 5, order_index: 1, accepted_patterns: ['^ls$'] });
    const q2 = await createQuestion({ variant_index: 5, order_index: 2, accepted_patterns: ['^ls$'] });

    await post({ session_token: participant.session_token, cmd: 'ls', exit_code: 0 });

    const passed = await db.all(`SELECT question_id FROM submissions WHERE participant_id = $1 AND auto_result = 'pass'`, [participant.id]);
    expect(passed.map((r) => r.question_id)).toEqual([q1.id]);
    expect(passed.map((r) => r.question_id)).not.toContain(q2.id);
  });
});

describe('authorisation & guards', () => {
  test('an unknown session_token -> 403 and nothing logged', async () => {
    const res = await post({ session_token: 'does-not-exist', cmd: 'ls', exit_code: 0 });
    expect(res.status).toBe(403);
  });

  test('a participant whose container is no longer active -> 403 and the command is NOT logged', async () => {
    const session = await createSession({ status: 'running' });
    const ended = await createParticipant({
      session,
      user: await createStudent({ nim: '20220140099' }),
      container_status: 'ended',
    });
    const res = await post({ session_token: ended.session_token, cmd: 'ls', exit_code: 0 });
    expect(res.status).toBe(403);
    expect(await logsFor(ended.id)).toHaveLength(0);
  });

  test('missing cmd -> 400', async () => {
    const res = await post({ session_token: participant.session_token, exit_code: 0 });
    expect(res.status).toBe(400);
  });

  test('missing session_token -> 400', async () => {
    const res = await post({ cmd: 'ls', exit_code: 0 });
    expect(res.status).toBe(400);
  });
});

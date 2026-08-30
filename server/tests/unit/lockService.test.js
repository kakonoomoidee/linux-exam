const lockService = require('../../src/services/lockService');
const Session = require('../../src/models/Session');
const db = require('../../src/db/connection');
const { useTestDb } = require('../helpers/db');
const { createSession, createStudent, createParticipant } = require('../helpers/factory');

useTestDb();

let participant;
let other;

beforeEach(async () => {
  lockService._resetState();
  const session = await createSession({ status: 'running' });
  participant = await createParticipant({ session, user: await createStudent({ nim: '20220140050' }) });
  other = await createParticipant({ session, user: await createStudent({ nim: '20220140051' }) });
});

const freshRow = (id) => Session.getParticipant(id);

describe('unlock code generation', () => {
  test('is always exactly 6 digits, as a string, no dropped leading zero', async () => {
    for (let i = 0; i < 10; i++) {
      const row = await lockService.recordViolation(participant.id);
      expect(typeof row.lock_code).toBe('string');
      expect(row.lock_code).toMatch(/^[1-9]\d{5}$/); // 100000-999999, never starts with 0
    }
  });

  test('consecutive codes differ, and a large batch is structurally collision-free', async () => {
    const codes = new Set();
    let prev = null;
    for (let i = 0; i < 20; i++) {
      const { lock_code } = await lockService.recordViolation(participant.id);
      expect(lock_code).not.toBe(prev);
      codes.add(lock_code);
      prev = lock_code;
    }
    expect(codes.size).toBeGreaterThanOrEqual(19); // 20 draws from a 900k space
  });
});

describe('repeated violations', () => {
  test('violation_count increments by exactly 1 each time', async () => {
    expect((await lockService.recordViolation(participant.id)).violation_count).toBe(1);
    expect((await lockService.recordViolation(participant.id)).violation_count).toBe(2);
    expect((await lockService.recordViolation(participant.id)).violation_count).toBe(3);
  });

  test('a new violation invalidates the previous code', async () => {
    const { lock_code: code1 } = await lockService.recordViolation(participant.id);
    const { lock_code: code2 } = await lockService.recordViolation(participant.id);
    expect(code2).not.toBe(code1);

    expect(await lockService.attemptUnlock(participant.id, code1)).toEqual({ ok: false });
    expect(await lockService.attemptUnlock(participant.id, code2)).toEqual({ ok: true });
  });
});

describe('brute-force throttle', () => {
  test('wrong attempts 1-5 within a minute are processed, the 6th is throttled', async () => {
    await lockService.recordViolation(participant.id);
    for (let i = 1; i <= 5; i++) {
      const r = await lockService.attemptUnlock(participant.id, '000000');
      expect(r).toEqual({ ok: false }); // plain failure, not throttled
    }
    const sixth = await lockService.attemptUnlock(participant.id, '000000');
    expect(sixth).toEqual({ ok: false, throttled: true });
  });

  test('the throttle counter is per-participant, not global', async () => {
    await lockService.recordViolation(participant.id);
    await lockService.recordViolation(other.id);
    for (let i = 0; i < 6; i++) await lockService.attemptUnlock(participant.id, '000000');
    expect((await lockService.attemptUnlock(participant.id, '000000')).throttled).toBe(true);

    // a different participant is unaffected
    expect(await lockService.attemptUnlock(other.id, '000000')).toEqual({ ok: false });
  });

  test('the throttle window resets after a minute', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    try {
      await lockService.recordViolation(participant.id);
      for (let i = 0; i < 6; i++) await lockService.attemptUnlock(participant.id, '000000');
      expect((await lockService.attemptUnlock(participant.id, '000000')).throttled).toBe(true);

      jest.setSystemTime(new Date('2026-01-01T00:01:01Z')); // +61s
      const afterWindow = await lockService.attemptUnlock(participant.id, '000000');
      expect(afterWindow).toEqual({ ok: false }); // processed again, not auto-throttled
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('unlock', () => {
  test('surrounding whitespace on the code is trimmed', async () => {
    const { lock_code } = await lockService.recordViolation(participant.id);
    expect(await lockService.attemptUnlock(participant.id, `  ${lock_code}\n`)).toEqual({ ok: true });
  });

  test('a wrong code returns nothing but { ok: false } — no reason leaked', async () => {
    await lockService.recordViolation(participant.id);
    const r = await lockService.attemptUnlock(participant.id, '123456');
    expect(Object.keys(r)).toEqual(['ok']);
    expect(r.ok).toBe(false);
  });

  test('a successful unlock fully clears lock state and cannot be replayed', async () => {
    const { lock_code } = await lockService.recordViolation(participant.id);
    expect(lockService.isLocked(participant.id)).toBe(true);

    expect(await lockService.attemptUnlock(participant.id, lock_code)).toEqual({ ok: true });

    expect(lockService.isLocked(participant.id)).toBe(false);
    const row = await freshRow(participant.id);
    expect(row.locked_at).toBeNull();
    expect(row.lock_code).toBeNull();

    // same code a second time must not unlock again
    expect(await lockService.attemptUnlock(participant.id, lock_code)).toEqual({ ok: false });
  });
});

describe('rehydrate & forceUnlock', () => {
  test('rehydrate re-locks in memory when the DB row still says locked', async () => {
    await db.run(
      `UPDATE session_participants SET lock_code = '654321', locked_at = now() WHERE id = $1`,
      [participant.id]
    );
    expect(lockService.isLocked(participant.id)).toBe(false); // memory cleared
    lockService.rehydrate(await freshRow(participant.id));
    expect(lockService.isLocked(participant.id)).toBe(true);
  });

  test('rehydrate is a no-op for a participant with no lock', async () => {
    lockService.rehydrate(await freshRow(participant.id));
    expect(lockService.isLocked(participant.id)).toBe(false);
  });

  test('forceUnlock clears state like a correct code, no code required', async () => {
    await lockService.recordViolation(participant.id);
    expect(lockService.isLocked(participant.id)).toBe(true);

    await lockService.forceUnlock(participant.id);

    expect(lockService.isLocked(participant.id)).toBe(false);
    const row = await freshRow(participant.id);
    expect(row.locked_at).toBeNull();
    expect(row.lock_code).toBeNull();
  });
});

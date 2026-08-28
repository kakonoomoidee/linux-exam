/**
 * Anti-cheat "lockdown on tab-switch". The client detects the student leaving
 * the exam tab (visibilitychange / window.blur) and locks its own UI; this
 * service is the server side: it owns the unlock code, the audit counter, and
 * an in-memory set of currently-locked participants that terminalSocket checks
 * so a locked student can't type even if they bypass the client-side disable.
 *
 * NOTE: the exam timer is deliberately NOT paused while locked — leaving the
 * tab must never buy extra time.
 */
const crypto = require('crypto');
const Session = require('../models/Session');

// participantId -> true. Fast path for terminalSocket (per-keystroke check).
// locked_at in the DB is the durable source of truth; this is rehydrated from
// it on student:join so a server restart mid-exam doesn't drop a lock.
const lockedIds = new Set();

// participantId -> { count, windowStart } — brute-force throttle. 6 digits is
// only 900k combos, so cap attempts per minute.
const attempts = new Map();
const MAX_ATTEMPTS_PER_MIN = 5;
const WINDOW_MS = 60_000;

function isLocked(participantId) {
  return lockedIds.has(participantId);
}

/** Record a violation: fresh code, bump count, mark locked. Returns the row. */
async function recordViolation(participantId) {
  const code = String(crypto.randomInt(100000, 1000000)); // 100000–999999, 6 digits
  const row = await Session.recordViolation(participantId, code);
  lockedIds.add(participantId);
  return row;
}

/** Re-add to the in-memory set if the DB says this participant is still locked. */
function rehydrate(participant) {
  if (participant && participant.locked_at && participant.lock_code) {
    lockedIds.add(participant.id);
  }
}

function throttled(participantId) {
  const a = attempts.get(participantId);
  if (!a || Date.now() - a.windowStart > WINDOW_MS) return false;
  return a.count >= MAX_ATTEMPTS_PER_MIN;
}

function noteFailedAttempt(participantId) {
  const a = attempts.get(participantId);
  if (!a || Date.now() - a.windowStart > WINDOW_MS) {
    attempts.set(participantId, { count: 1, windowStart: Date.now() });
  } else {
    a.count += 1;
  }
}

/**
 * Student-supplied code. Returns { ok } or { ok:false, throttled }.
 * Never says *why* a code is wrong beyond that — no "close" / "expired" hints.
 */
async function attemptUnlock(participantId, code) {
  if (throttled(participantId)) return { ok: false, throttled: true };

  const fresh = await Session.getParticipant(participantId);
  const expected = (fresh && fresh.lock_code ? String(fresh.lock_code) : '').trim();
  const given = String(code || '').trim();

  if (!expected || given.toLowerCase() !== expected.toLowerCase()) {
    noteFailedAttempt(participantId);
    return { ok: false };
  }

  await Session.clearLock(participantId);
  lockedIds.delete(participantId);
  attempts.delete(participantId);
  return { ok: true };
}

/** Admin "Force Unlock" — no code needed (false positive, or just faster). */
async function forceUnlock(participantId) {
  await Session.clearLock(participantId);
  lockedIds.delete(participantId);
  attempts.delete(participantId);
}

module.exports = { isLocked, recordViolation, rehydrate, attemptUnlock, forceUnlock };

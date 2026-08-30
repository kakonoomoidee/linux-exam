/**
 * Server-side timers so the exam clock can never be manipulated from the
 * browser. One setTimeout per running session, armed when the instructor starts
 * the exam (see examService.ensureSessionTimer); on expiry it ends every active
 * participant at once. Keyed generically so callers own the key namespace.
 */
const timers = new Map(); // key -> Timeout handle

function schedule(key, endsAtIso, onExpire) {
  cancel(key);
  const msLeft = new Date(endsAtIso).getTime() - Date.now();
  const delay = Math.max(msLeft, 0);
  const handle = setTimeout(() => {
    timers.delete(key);
    onExpire(key).catch((err) =>
      console.error(`[timerService] onExpire failed for ${key}`, err)
    );
  }, delay);
  timers.set(key, handle);
}

function cancel(key) {
  const existing = timers.get(key);
  if (existing) {
    clearTimeout(existing);
    timers.delete(key);
  }
}

function remainingMs(endsAtIso) {
  return Math.max(new Date(endsAtIso).getTime() - Date.now(), 0);
}

module.exports = { schedule, cancel, remainingMs };

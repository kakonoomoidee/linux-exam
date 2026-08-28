/**
 * Server-side timers so the exam clock can never be manipulated from the
 * browser. One setTimeout per participant, scheduled the moment their
 * container becomes ready (see containerService.provisionParticipant).
 */
const timers = new Map(); // participantId -> Timeout handle

function schedule(participantId, endsAtIso, onExpire) {
  cancel(participantId);
  const msLeft = new Date(endsAtIso).getTime() - Date.now();
  const delay = Math.max(msLeft, 0);
  const handle = setTimeout(() => {
    timers.delete(participantId);
    onExpire(participantId).catch((err) =>
      console.error(`[timerService] onExpire failed for participant ${participantId}`, err)
    );
  }, delay);
  timers.set(participantId, handle);
}

function cancel(participantId) {
  const existing = timers.get(participantId);
  if (existing) {
    clearTimeout(existing);
    timers.delete(participantId);
  }
}

function remainingMs(endsAtIso) {
  return Math.max(new Date(endsAtIso).getTime() - Date.now(), 0);
}

module.exports = { schedule, cancel, remainingMs };

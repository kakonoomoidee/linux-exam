const Session = require('../models/Session');
const Question = require('../models/Question');
const { Submission } = require('../models/Submission');
const containerService = require('./containerService');
const timerService = require('./timerService');

let io = null; // set by sockets/index.js at boot to avoid a require cycle
function attachIo(socketIoInstance) {
  io = socketIoInstance;
}

function emitToParticipant(sessionToken, event, payload) {
  if (io) io.to(`participant:${sessionToken}`).emit(event, payload);
}

/**
 * Provisioning is lazy per-student now: "Start" only flips the session to
 * running and reveals the join code (see startSession). A participant's
 * container is provisioned when THEY submit the join code from their dashboard
 * (routes/student.js -> POST /me/join calls provisionOne for that one student).
 * Each participant's exam timer still starts only once THEIR container is
 * ready (see containerService), not at "Start".
 */
/** Provision one participant's container and start their personal timer. */
async function provisionOne(participant, session) {
  const updated = await containerService.provisionParticipant(participant, session.duration_minutes);
  if (updated.container_status === 'active') {
    timerService.schedule(updated.id, updated.ends_at, endParticipant);
    emitToParticipant(updated.session_token, 'exam:ready', { endsAt: updated.ends_at });
  } else {
    emitToParticipant(updated.session_token, 'exam:error', {
      message: 'Gagal menyiapkan environment. Hubungi asisten dosen.',
    });
  }
  return updated;
}

async function startSession(sessionId) {
  await Session.markRunning(sessionId);
  await Session.ensureJoinCode(sessionId); // students provision themselves via POST /me/join
  return Session.findById(sessionId);
}

/** Called when a participant's timer expires OR they submit manually. */
async function endParticipant(participantId) {
  timerService.cancel(participantId);
  const participant = await Session.getParticipant(participantId);
  if (!participant) return;

  // idempotency guard: two triggers can race (student hits Submit right as
  // the timer fires) — only the first one should actually run this.
  if (!['active'].includes(participant.container_status)) return;

  // Flip the gate immediately, before any container work. cmd-log grading
  // and the terminal socket both key off this status, so from this instant
  // the exam is over for the student regardless of how long teardown takes
  // or whether it succeeds at all — teardown must never be what the student
  // (or the "10 minutes is up" guarantee) waits on.
  await Session.updateParticipant(participant.id, { container_status: 'ending' });

  const questions = await Question.listForVariantIndex(participant.variant_index);

  // run any state_check / both questions' final validation before destroying the container
  for (const q of questions) {
    if (q.check_type === 'state_check' || q.check_type === 'both') {
      const existing = await Submission.get(participant.id, q.id);
      if (existing && existing.auto_result === 'pass') continue; // already solved via command match
      try {
        const passed = await containerService.runStateChecker(participant.container_id, q.state_checker_script);
        await Submission.markAutoResult(participant.id, q.id, {
          auto_result: passed ? 'pass' : 'fail',
          auto_score: passed ? q.point : 0,
        });
      } catch (err) {
        console.error(`[examService] state checker failed for Q${q.id}`, err.message);
      }
    }
  }

  // Best-effort: a teardown failure (container already gone, docker daemon
  // hiccup, image issue) must never stop the exam from being marked ended —
  // the student is actively waiting on this to resolve.
  try {
    await containerService.teardownParticipant(participant);
  } catch (err) {
    console.error(`[examService] teardown failed for participant ${participant.id}, ending anyway`, err.message);
  }

  await Session.updateParticipant(participant.id, { container_status: 'ended' });

  const submissions = await Submission.listForParticipant(participant.id);
  emitToParticipant(participant.session_token, 'exam:ended', { submissions });

  // Hard stop: force-close any lingering terminal socket(s) for this
  // participant a beat after the payload above, so the browser can't keep
  // sending terminal:input after time is up even if the client-side screen
  // switch is somehow bypassed.
  if (io) {
    setTimeout(() => {
      io.in(`participant:${participant.session_token}`).disconnectSockets(true);
    }, 300);
  }
}

/** Student clicks "Submit" before time runs out. */
async function submitParticipant(participantId) {
  return endParticipant(participantId);
}

/**
 * Admin deletes a session (any status). Cancels pending timers and best-effort
 * tears down any live containers, then drops the row — participants, command
 * logs and submissions cascade away with it.
 */
async function deleteSession(sessionId) {
  const participants = await Session.listParticipants(sessionId);
  await Promise.all(
    participants.map(async (p) => {
      timerService.cancel(p.id);
      // always attempt teardown — teardownParticipant handles the no-container
      // case itself and can still catch an orphan by its deterministic name.
      try {
        await containerService.teardownParticipant(p);
      } catch (err) {
        console.error(`[examService] teardown on delete failed for participant ${p.id}`, err.message);
      }
    })
  );
  await Session.remove(sessionId);
}

module.exports = {
  attachIo,
  startSession,
  provisionOne,
  endParticipant,
  submitParticipant,
  deleteSession,
};

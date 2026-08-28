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
 * Admin clicks "Start": provisions containers for every participant in
 * parallel. Each participant's own exam timer starts only once THEIR
 * container is ready (see containerService), not when this function returns.
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
  const session = await Session.markRunning(sessionId);
  const participants = await Session.listParticipants(sessionId);
  await Promise.all(participants.map((p) => provisionOne(p, session)));
  return Session.findById(sessionId);
}

/** Called when a participant's timer expires OR they submit manually. */
async function endParticipant(participantId) {
  timerService.cancel(participantId);
  const participant = await Session.getParticipant(participantId);
  if (!participant || participant.container_status !== 'active') return;

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
        console.error(`[examService] state checker failed for Q${q.id}`, err);
      }
    }
  }

  await containerService.teardownParticipant(participant);
  await Session.updateParticipant(participant.id, { container_status: 'ended' });

  const submissions = await Submission.listForParticipant(participant.id);
  emitToParticipant(participant.session_token, 'exam:ended', { submissions });
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
      if (p.container_id) {
        try {
          await containerService.teardownParticipant(p);
        } catch (err) {
          console.error(`[examService] teardown on delete failed for participant ${p.id}`, err);
        }
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

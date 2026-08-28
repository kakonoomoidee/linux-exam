const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const Session = require('../models/Session');
const { buildDriver } = require('./containerDrivers');

const driver = buildDriver();

/**
 * Provisions a container for one participant, sets their session_token
 * (used to authenticate the callback + the student's browser session),
 * and starts their personal exam timer once the container is ready.
 * Timer starts here, NOT when the admin clicks "Start" — so slow container
 * boot never eats into a student's 10 minutes.
 */
async function provisionParticipant(participant, durationMinutes) {
  const sessionToken = uuidv4();
  await Session.updateParticipant(participant.id, {
    container_status: 'provisioning',
    session_token: sessionToken,
  });

  try {
    const containerId = await driver.create({
      participantId: participant.id,
      sessionToken,
    });

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

    return Session.updateParticipant(participant.id, {
      container_id: containerId,
      container_status: 'active',
      started_at: startedAt.toISOString(),
      ends_at: endsAt.toISOString(),
    });
  } catch (err) {
    console.error(`[containerService] provisioning failed for participant ${participant.id}`, err);
    return Session.updateParticipant(participant.id, { container_status: 'error' });
  }
}

/** Runs a question's state_checker_script inside the container; expects last output line PASS/FAIL. */
async function runStateChecker(containerId, script) {
  const { output } = await driver.exec(containerId, script);
  const lastLine = output.trim().split('\n').pop();
  return lastLine === 'PASS';
}

async function teardownParticipant(participant) {
  if (participant.container_id) {
    await driver.destroy(participant.container_id);
  }
  return Session.updateParticipant(participant.id, {
    container_status: 'destroyed',
  });
}

async function attachInteractive(containerId) {
  return driver.attachInteractive(containerId);
}

module.exports = {
  provisionParticipant,
  runStateChecker,
  teardownParticipant,
  attachInteractive,
};

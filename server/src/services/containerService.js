const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const Session = require('../models/Session');
const { buildDriver } = require('./containerDrivers');

const driver = buildDriver();

/**
 * Races a driver call against a timeout so a hung Docker daemon connection
 * (dead socket, dockerode promise that never settles) can never block exam
 * flow forever — it surfaces as a normal rejected promise instead.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
    const containerId = await withTimeout(
      driver.create({ participantId: participant.id, sessionToken }),
      20000,
      'container create'
    );

    const startedAt = new Date();
    const endsAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

    return Session.updateParticipant(participant.id, {
      container_id: containerId,
      container_status: 'active',
      started_at: startedAt.toISOString(),
      ends_at: endsAt.toISOString(),
    });
  } catch (err) {
    // most common cause: CONTAINER_DRIVER=docker but the tekser-sandbox image
    // was never built, so dockerode's createContainer 404s on the image name.
    console.error(`[containerService] provisioning failed for participant ${participant.id}`, err.message);
    return Session.updateParticipant(participant.id, { container_status: 'error' });
  }
}

/** Runs a question's state_checker_script inside the container; expects last output line PASS/FAIL. */
async function runStateChecker(containerId, script) {
  const { output } = await withTimeout(driver.exec(containerId, script), 10000, 'state checker exec');
  const lastLine = output.trim().split('\n').pop();
  return lastLine === 'PASS';
}

async function teardownParticipant(participant) {
  // container_id is the reliable handle; fall back to the deterministic name
  // (tekser-<session_token>, see DockerDriver.create) so a container orphaned
  // before its id was persisted — provisioning crashed mid-create — still gets
  // swept up. driver.destroy is idempotent, so a missing container is a no-op.
  const handle =
    participant.container_id ||
    (participant.session_token && `tekser-${participant.session_token}`);
  if (handle) {
    await withTimeout(driver.destroy(handle), 10000, 'container destroy');
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

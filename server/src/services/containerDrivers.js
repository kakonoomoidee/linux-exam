const config = require('../config');

/**
 * Real driver: spins up an isolated, resource-limited container per
 * participant from the pre-built sandbox image, on a dedicated Docker
 * network (SANDBOX_NETWORK, `internal: true` in docker-compose.yml) that
 * has no route to the internet but CAN reach the `app` service — that's
 * what lets the container's shell hook call back to CMD_LOG_CALLBACK_URL
 * for live command grading while still being cut off from the outside world.
 * The image's /etc/profile.d/tekser-hook.sh (see docker/) posts every
 * executed command back to CMD_LOG_CALLBACK_URL via the PROMPT_COMMAND hook.
 */
class DockerDriver {
  constructor() {
    const Docker = require('dockerode');
    this.docker = new Docker();
  }

  async create({ participantId, sessionToken }) {
    const container = await this.docker.createContainer({
      Image: config.sandboxImage,
      name: `tekser-${sessionToken}`,
      Tty: true,
      OpenStdin: true,
      Env: [
        `PARTICIPANT_ID=${participantId}`,
        `SESSION_TOKEN=${sessionToken}`,
        `CMD_LOG_CALLBACK_URL=${config.cmdLogCallbackUrl}`,
      ],
      HostConfig: {
        Memory: config.containerMemoryMb * 1024 * 1024,
        NanoCpus: Math.round(config.containerCpus * 1e9),
        PidsLimit: config.containerPidsLimit,
        // internal-only network: no internet, but can still reach `app`
        // for grading callbacks (see docker-compose.yml). NOT 'none' —
        // that would also block the callback the whole grading pipeline
        // depends on.
        NetworkMode: config.sandboxNetwork,
        AutoRemove: false,
      },
    });
    await container.start();
    return container.id;
  }

  /** Runs a command inside a running container, returns { exitCode, output }. */
  async exec(containerId, cmd) {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-lc', cmd],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({});
    const output = await new Promise((resolve, reject) => {
      let data = '';
      stream.on('data', (chunk) => (data += chunk.toString('utf8')));
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
    const inspect = await exec.inspect();
    return { exitCode: inspect.ExitCode, output };
  }

  /**
   * Stop + remove a container. Idempotent: if the container is already gone
   * (404) that's the desired end state, so it counts as success — a stale DB
   * row or a double teardown must not spam errors. Only a genuinely broken
   * daemon (any other status) propagates.
   * `containerId` may be an id or the container name (`tekser-<token>`).
   */
  async destroy(containerId) {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop({ t: 2 });
    } catch (e) {
      if (e.statusCode !== 404 && e.statusCode !== 304) throw e; // 304 = already stopped
    }
    try {
      await container.remove({ force: true });
    } catch (e) {
      if (e.statusCode !== 404) throw e; // already removed → idempotent success
    }
  }

  /**
   * Returns a stream-like exec attach for the interactive PTY bridge (see
   * sockets/terminalSocket.js).
   *
   * `-l` (login shell) is REQUIRED: the command-logging hook lives at
   * /etc/profile.d/tekser-hook.sh and is only sourced by login shells. A plain
   * `docker exec bash` is an interactive NON-login shell — it never reads
   * /etc/profile, so PROMPT_COMMAND is never set and no command is ever
   * reported for grading. (The image's default CMD is `bash -l`, but that's a
   * different process the student never touches — they connect via this exec.)
   */
  async attachInteractive(containerId) {
    const container = this.docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-l'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    return stream;
  }
}

/**
 * Mock driver: no docker daemon required. Used for local development of the
 * web app (dashboard, session flow, DB, sockets) without needing Docker installed.
 * It fakes container ids and simulates exec by just returning the command
 * back with exit code 0. NOT for real exams.
 */
class MockDriver {
  constructor() {
    this._counter = 0;
  }

  async create({ participantId }) {
    this._counter += 1;
    return `mock-container-${participantId}-${this._counter}`;
  }

  async exec(containerId, cmd) {
    console.log(`[mock-driver] exec on ${containerId}: ${cmd}`);
    return { exitCode: 0, output: '(mock output)' };
  }

  async destroy(containerId) {
    console.log(`[mock-driver] destroyed ${containerId}`);
  }

  async attachInteractive(containerId) {
    throw new Error('MockDriver does not support interactive terminals. Set CONTAINER_DRIVER=docker.');
  }
}

function buildDriver() {
  return config.containerDriver === 'docker' ? new DockerDriver() : new MockDriver();
}

module.exports = { buildDriver, DockerDriver, MockDriver };

const containerService = require('../services/containerService');
const lockService = require('../services/lockService');

/**
 * Live screen-mirror for staff: the last ~64KB of raw terminal output per
 * active participant, keyed by session_token. Lets a staff member who opens
 * (or re-opens) the watch modal see the current screen state instead of a
 * blank pane. Entries are dropped on socket disconnect, stream end, and by
 * closeWatch() from the exam lifecycle — the Map only ever holds currently
 * active, currently connected participants.
 */
const WATCH_BUF_MAX = 64 * 1024;
const watchBuffers = new Map();

function appendWatchBuffer(token, chunk) {
  // ponytail: concat + slice, O(n) per chunk with n<=64KB — fine for a shell
  // stream. Swap for a real ring buffer only if profiling ever says so.
  watchBuffers.set(token, ((watchBuffers.get(token) || '') + chunk).slice(-WATCH_BUF_MAX));
}

function getWatchBuffer(token) {
  return watchBuffers.get(token) || '';
}

/**
 * Participant's terminal is gone for good (submit / deadline / session delete):
 * tell any staff watching so their modal shows an end notice instead of
 * freezing, and drop the buffer. Called from examService. Idempotent.
 */
function closeWatch(io, token) {
  if (io) io.to(`watch:${token}`).emit('terminal:closed');
  watchBuffers.delete(token);
}

function watchBufferCount() {
  return watchBuffers.size;
}

/**
 * Bridges one socket connection's terminal input/output to the participant's
 * container exec stream. Command *evaluation* does NOT happen here — that's
 * the job of the container's own PROMPT_COMMAND hook posting to /api/cmd-log
 * (see docker/bashrc-hook.sh + routes/cmdLog.js). This socket is purely I/O.
 */
function registerTerminalHandlers(io, socket, participant) {
  let containerStream = null;
  const watchRoom = `watch:${participant.session_token}`;

  (async () => {
    if (participant.container_status !== 'active' || !participant.container_id) {
      socket.emit('terminal:error', { message: 'Container belum siap' });
      return;
    }
    try {
      containerStream = await containerService.attachInteractive(participant.container_id);
      containerStream.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        socket.emit('terminal:output', text);
        // mirror the same bytes to any watching staff, and keep them for replay
        appendWatchBuffer(participant.session_token, text);
        io.to(watchRoom).emit('terminal:output', text);
      });
      containerStream.on('end', () => {
        socket.emit('terminal:closed');
        // transient end (client refresh ends our write side): buffer cleanup
        // only, no watcher notice — live output resumes when they reconnect.
        watchBuffers.delete(participant.session_token);
      });
    } catch (err) {
      console.error(`[terminalSocket] attach failed for participant ${participant.id}`, err);
      socket.emit('terminal:error', { message: 'Gagal terhubung ke terminal' });
    }
  })();

  socket.on('terminal:input', (data) => {
    // defense in depth: the client also disables the terminal on lock, but a
    // locked student must not be able to type by emitting straight from devtools.
    if (lockService.isLocked(participant.id)) return;
    if (containerStream) containerStream.write(data);
  });

  socket.on('disconnect', () => {
    // intentionally does NOT destroy the container: a dropped connection
    // (wifi hiccup, refresh) should let the student reconnect and resume,
    // since the server-side timer keeps running regardless.
    if (containerStream) containerStream.end();
    watchBuffers.delete(participant.session_token);
  });
}

module.exports = {
  registerTerminalHandlers,
  getWatchBuffer,
  closeWatch,
  appendWatchBuffer,
  watchBufferCount,
};

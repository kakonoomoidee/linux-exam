const containerService = require('../services/containerService');
const lockService = require('../services/lockService');

/**
 * Bridges one socket connection's terminal input/output to the participant's
 * container exec stream. Command *evaluation* does NOT happen here — that's
 * the job of the container's own PROMPT_COMMAND hook posting to /api/cmd-log
 * (see docker/bashrc-hook.sh + routes/cmdLog.js). This socket is purely I/O.
 */
function registerTerminalHandlers(io, socket, participant) {
  let containerStream = null;

  (async () => {
    if (participant.container_status !== 'active' || !participant.container_id) {
      socket.emit('terminal:error', { message: 'Container belum siap' });
      return;
    }
    try {
      containerStream = await containerService.attachInteractive(participant.container_id);
      containerStream.on('data', (chunk) => socket.emit('terminal:output', chunk.toString('utf8')));
      containerStream.on('end', () => socket.emit('terminal:closed'));
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
  });
}

module.exports = registerTerminalHandlers;

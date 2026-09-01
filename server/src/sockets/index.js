const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const Session = require('../models/Session');
const examService = require('../services/examService');
const lockService = require('../services/lockService');
const { registerTerminalHandlers, getWatchBuffer } = require('./terminalSocket');

let ioInstance = null;

function getIo() {
  return ioInstance;
}

function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });
  ioInstance = io;
  examService.attachIo(io);

  // In-memory timers don't survive a restart. Re-arm the session-wide exam
  // timer for anything still running; a deadline already in the past fires
  // immediately (timerService clamps the delay to 0).
  Session.listRunning()
    .then((rows) => rows.forEach((s) => examService.ensureSessionTimer(s)))
    .catch((err) => console.error('[sockets] failed to re-arm session timers on boot', err));

  io.on('connection', (socket) => {
    // --- student joins their own exam room, authenticated by their session_token ---
    socket.on('student:join', async ({ sessionToken }) => {
      const participant = await Session.findParticipantByToken(sessionToken);
      if (!participant) return socket.emit('exam:error', { message: 'Token sesi tidak valid' });
      socket.join(`participant:${sessionToken}`);
      socket.data.participant = participant;
      registerTerminalHandlers(io, socket, participant);

      // re-sync the exam clock for anyone who joined after (or missed) the
      // room-wide exam:ready — a refresh mid-exam, or a socket that connected
      // while their container was still provisioning. The deadline is
      // session-wide (started_at + duration), not per-participant.
      if (participant.container_status === 'active') {
        const session = await Session.findById(participant.session_id);
        const endsAt = examService.sessionDeadline(session)?.toISOString();
        if (endsAt) socket.emit('exam:ready', { endsAt });
      }

      // if they refreshed (or the server restarted) while locked, restore the lock
      lockService.rehydrate(participant);
      if (participant.locked_at && participant.lock_code) {
        socket.emit('exam:locked', {});
      }
    });

    // --- anti-cheat: client reports the student left the exam tab ---
    socket.on('student:violation', async ({ sessionToken }) => {
      const participant = await Session.findParticipantByToken(sessionToken);
      if (!participant || participant.container_status !== 'active') return;

      const row = await lockService.recordViolation(participant.id);
      io.to('admin-dashboard').emit('admin:violation', {
        participantId: participant.id,
        nim: participant.nim,
        name: participant.name,
        code: row.lock_code, // code is admin-only — never sent to the student
        violationCount: row.violation_count,
        timestamp: row.locked_at,
      });
      io.to(`participant:${sessionToken}`).emit('exam:locked', {});
    });

    // --- student types the unlock code the assistant reads out ---
    socket.on('student:unlock', async ({ code }) => {
      const participant = socket.data.participant
        && (await Session.findParticipantByToken(socket.data.participant.session_token));
      if (!participant) return;

      const result = await lockService.attemptUnlock(participant.id, code);
      if (!result.ok) {
        socket.emit('exam:unlock_failed', { throttled: Boolean(result.throttled) });
        return;
      }
      io.to(`participant:${participant.session_token}`).emit('exam:unlocked', {});
      io.to('admin-dashboard').emit('admin:unlocked', {
        participantId: participant.id,
        nim: participant.nim,
      });
    });

    // --- admin joins the live dashboard room, authenticated by JWT ---
    socket.on('admin:join', ({ token }) => {
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        if (!['instruktur', 'asisten'].includes(decoded.role)) throw new Error('not staff');
        socket.join('admin-dashboard');
      } catch (err) {
        socket.emit('exam:error', { message: 'Token admin tidak valid' });
      }
    });

    // --- staff watches one student's terminal live (read-only screen mirror) ---
    // Joins the watch:<session_token> room that terminalSocket.js fans output
    // into, and replays the ring buffer so a late join sees the current screen.
    // Purely read-only: there is no path from here to containerStream.write.
    socket.on('admin:watch-terminal', async ({ token, sessionToken }) => {
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        if (!['instruktur', 'asisten'].includes(decoded.role)) throw new Error('not staff');
      } catch (err) {
        return socket.emit('terminal:error', { message: 'Token admin tidak valid' });
      }
      const participant = await Session.findParticipantByToken(sessionToken);
      if (!participant || participant.container_status !== 'active') {
        return socket.emit('terminal:error', { message: 'Terminal mahasiswa tidak aktif' });
      }
      socket.join(`watch:${sessionToken}`);
      const buf = getWatchBuffer(sessionToken);
      if (buf) socket.emit('terminal:output', buf);
    });

    socket.on('admin:unwatch-terminal', ({ sessionToken }) => {
      socket.leave(`watch:${sessionToken}`);
    });
  });

  return io;
}

module.exports = { initSockets, getIo };

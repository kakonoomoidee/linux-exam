const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const Session = require('../models/Session');
const examService = require('../services/examService');
const lockService = require('../services/lockService');
const registerTerminalHandlers = require('./terminalSocket');

let ioInstance = null;

function getIo() {
  return ioInstance;
}

function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } });
  ioInstance = io;
  examService.attachIo(io);

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
      // while their container was still provisioning.
      if (participant.container_status === 'active' && participant.ends_at) {
        socket.emit('exam:ready', { endsAt: participant.ends_at });
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
        if (decoded.role !== 'admin') throw new Error('not admin');
        socket.join('admin-dashboard');
      } catch (err) {
        socket.emit('exam:error', { message: 'Token admin tidak valid' });
      }
    });
  });

  return io;
}

module.exports = { initSockets, getIo };

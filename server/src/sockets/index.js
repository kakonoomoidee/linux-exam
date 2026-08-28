const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const Session = require('../models/Session');
const examService = require('../services/examService');
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

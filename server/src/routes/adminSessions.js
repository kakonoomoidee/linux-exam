const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const Session = require('../models/Session');
const User = require('../models/User');
const examService = require('../services/examService');
const config = require('../config');

const router = express.Router();
router.use(requireAdmin);

// Create a new exam session (not started yet)
router.post('/', async (req, res) => {
  const { name, duration_minutes } = req.body;
  if (!name) return res.status(400).json({ error: 'name wajib diisi' });
  const session = await Session.create({
    name,
    duration_minutes: duration_minutes || config.defaultSessionDurationMinutes,
  });
  res.status(201).json(session);
});

router.get('/', async (req, res) => {
  res.json(await Session.listAll());
});

router.get('/:id', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  res.json({ ...session, participants: await Session.listParticipants(session.id) });
});

// Add participants by NIM list. Auto-creates the student account and
// auto-derives their question variant from the last digit of their NIM.
router.post('/:id/participants', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

  const { nims } = req.body; // array of "NIM" strings or { nim, name, kelas } objects (parsed client-side)
  if (!Array.isArray(nims) || nims.length === 0) {
    return res.status(400).json({ error: 'nims (array) wajib diisi' });
  }

  const added = [];
  for (const entry of nims) {
    const nim = typeof entry === 'string' ? entry.trim() : entry.nim;
    const name = typeof entry === 'object' ? entry.name : null;
    const kelas = typeof entry === 'object' ? entry.kelas : null;
    const user = await User.findOrCreateStudent(nim, name, kelas);
    const variantIndex = User.variantIndexForNim(nim);
    added.push(await Session.addParticipant(session.id, user.id, variantIndex));
  }

  res.status(201).json(added);
});

// The big red button. Flips the session to running and reveals the join code —
// it does NOT provision anyone. Each student provisions themselves when they
// submit the join code (POST /me/join). A student whose join-time provision
// errored just re-submits the code from their dashboard — no admin re-provision.
router.post('/:id/start', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

  if (session.status === 'running') {
    // Idempotent: heal a missing join code (e.g. a half-finished first start) and return it.
    return res.json(await Session.ensureJoinCode(session.id));
  }

  res.status(202).json({ message: 'Sesi dimulai', sessionId: session.id });
  examService.startSession(session.id).catch((err) =>
    console.error(`[adminSessions] startSession failed for ${session.id}`, err)
  );
});

router.get('/:id/participants', async (req, res) => {
  res.json(await Session.listParticipants(req.params.id));
});

router.delete('/:id', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  await examService.deleteSession(session.id);
  res.json({ ok: true });
});

module.exports = router;

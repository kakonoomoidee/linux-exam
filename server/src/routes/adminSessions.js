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

  const { nims } = req.body; // array of strings, optionally "NIM,Nama" per line handled client-side
  if (!Array.isArray(nims) || nims.length === 0) {
    return res.status(400).json({ error: 'nims (array) wajib diisi' });
  }

  const added = [];
  for (const entry of nims) {
    const nim = typeof entry === 'string' ? entry.trim() : entry.nim;
    const name = typeof entry === 'object' ? entry.name : null;
    const user = await User.findOrCreateStudent(nim, name);
    const variantIndex = User.variantIndexForNim(nim);
    added.push(await Session.addParticipant(session.id, user.id, variantIndex));
  }

  res.status(201).json(added);
});

// The big red button.
router.post('/:id/start', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

  if (session.status === 'running') {
    const participants = await Session.listParticipants(session.id);
    const stuck = participants.filter(
      (p) => !['active', 'ended', 'destroyed'].includes(p.container_status)
    );
    if (stuck.length === 0) {
      return res.status(400).json({ error: 'Sesi sudah berjalan dan semua peserta aktif' });
    }
    // re-provision cuma yang nyangkut, bukan reset semua sesi
    res.status(202).json({ message: `Re-provisioning ${stuck.length} peserta yang nyangkut`, sessionId: session.id });
    Promise.all(stuck.map((p) => examService.provisionOne(p, session))).catch((err) =>
      console.error(`[adminSessions] re-provision failed for ${session.id}`, err)
    );
    return;
  }

  res.status(202).json({ message: 'Provisioning dimulai', sessionId: session.id });
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

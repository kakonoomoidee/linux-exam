const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const Session = require('../models/Session');
const User = require('../models/User');
const { normalizeKelas } = require('../lib/kelas');
const examService = require('../services/examService');
const config = require('../config');

const router = express.Router();
router.use(requireAdmin);

// Create a new exam session (not started yet)
router.post('/', async (req, res) => {
  const { name, duration_minutes, ucp } = req.body;
  if (!name) return res.status(400).json({ error: 'name wajib diisi' });
  // Selector is required in the UI; API defaults a missing value to UCP 1, but a
  // value that's present and not 1/2 is a client bug worth surfacing.
  if (ucp !== undefined && ![1, 2].includes(Number(ucp))) {
    return res.status(400).json({ error: 'ucp harus 1 atau 2' });
  }
  const session = await Session.create({
    name,
    duration_minutes: duration_minutes || config.defaultSessionDurationMinutes,
    ucp: ucp === undefined ? 1 : Number(ucp),
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
  const skipped = [];
  for (const entry of nims) {
    const nim = typeof entry === 'string' ? entry.trim() : String(entry.nim || '').trim();
    const name = typeof entry === 'object' ? entry.name : null;
    const rawKelas = typeof entry === 'object' ? entry.kelas : null;
    if (!nim) {
      skipped.push({ nim: '', error: 'NIM kosong' });
      continue;
    }
    // Empty kelas stays null (unchanged); a non-empty value must be a single letter A–F.
    let kelas = null;
    if (rawKelas != null && String(rawKelas).trim() !== '') {
      kelas = normalizeKelas(rawKelas);
      if (kelas === null) {
        skipped.push({ nim, kelas: rawKelas, error: 'kelas harus satu huruf A–F' });
        continue;
      }
    }
    const user = await User.findOrCreateStudent(nim, name, kelas);
    const variantIndex = User.variantIndexForNim(nim);
    added.push(await Session.addParticipant(session.id, user.id, variantIndex));
  }

  res.status(201).json({ added, skipped });
});

// The big red button. Flips the session to running and reveals the join code —
// it does NOT provision anyone. Each student provisions themselves when they
// submit the join code (POST /me/join). A student whose join-time provision
// errored just re-submits the code from their dashboard — no admin re-provision.
router.post('/:id/start', async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

  if (session.status === 'ended') {
    // An ended session is done for good — restarting it would re-open grading and
    // reset started_at. Next batch needs its own session.
    return res.status(409).json({
      error: 'Sesi ini sudah berakhir — buat sesi baru untuk batch berikutnya',
    });
  }

  if (session.status === 'running') {
    // Idempotent: heal a missing join code (e.g. a half-finished first start) and return it.
    return res.json(await Session.ensureJoinCode(session.id));
  }

  // Await the flip so the client's immediate re-fetch sees status='running'
  // + started_at (otherwise the GET races the write and the instructor has to
  // click twice). No container work happens here — that's lazy per join.
  res.json(await examService.startSession(session.id));
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

const express = require('express');
const { verify } = require('../lib/password');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');

const router = express.Router();

/**
 * Student login: NIM only (no password) since accounts are pre-provisioned
 * by the admin per session — this matches "ada list account nya siapa aja
 * yang bakal masuk sesi ini". Swap in a password check here later if needed.
 */
router.post('/login/student', async (req, res) => {
  const { nim } = req.body;
  if (!nim) return res.status(400).json({ error: 'nim wajib diisi' });

  const user = await User.findByNim(nim);
  if (!user || user.role !== 'student') {
    return res.status(404).json({ error: 'NIM tidak terdaftar' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, nim: user.nim, name: user.name, kelas: user.kelas },
  });
});

/** Staff login (instruktur / asisten): username (nim field reused) + password. */
router.post('/login/admin', async (req, res) => {
  const { nim, password } = req.body;
  const user = await User.findByNim(nim);
  if (!user || !['instruktur', 'asisten'].includes(user.role) || !user.password_hash) {
    return res.status(401).json({ error: 'Kredensial salah' });
  }
  if (!(await verify(password, user.password_hash))) {
    return res.status(401).json({ error: 'Kredensial salah' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, nim: user.nim, name: user.name, role: user.role },
  });
});

module.exports = router;

const express = require('express');
const { verify, checkStudentPassword } = require('../lib/password');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { signToken } = require('../middleware/auth');
const passwordResetService = require('../services/passwordResetService');

const router = express.Router();

// Identical response for every forgot-password outcome — see the route below.
const OTP_MAYBE_SENT = 'Kalau NIM terdaftar dan Telegram sudah terhubung, OTP akan dikirim.';

function auditLogin(req, user) {
  AuditLog.record({
    actorType: user.role === 'student' ? 'student' : 'staff',
    actorId: user.id,
    action: 'login',
    targetUserId: user.id,
    metadata: { role: user.role, ip: req.ip },
  }).catch((err) => console.error('[audit] login', err));
}

/**
 * Student login: NIM + password. The password defaults to the NIM and must be
 * changed on first login (mustChangePassword in the response + JWT claim). Legacy
 * rows created before student passwords have password_hash = NULL — for those the
 * password is the NIM and the change is always forced.
 */
router.post('/login/student', async (req, res) => {
  const { nim, password } = req.body;
  if (!nim) return res.status(400).json({ error: 'nim wajib diisi' });
  if (!password) return res.status(400).json({ error: 'password wajib diisi' });

  const user = await User.findByNim(nim);
  if (!user || user.role !== 'student') {
    return res.status(404).json({ error: 'NIM tidak terdaftar' });
  }
  if (!(await checkStudentPassword(user, password))) {
    return res.status(401).json({ error: 'Password salah' });
  }

  // A NULL-hash row must change regardless of the stored flag.
  const mustChangePassword = !user.password_hash || user.must_change_password;
  auditLogin(req, user);
  res.json({
    token: signToken({ ...user, must_change_password: mustChangePassword }),
    user: { id: user.id, nim: user.nim, name: user.name, kelas: user.kelas },
    mustChangePassword,
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
  auditLogin(req, user);
  res.json({
    token: signToken(user),
    user: { id: user.id, nim: user.nim, name: user.name, role: user.role },
  });
});

/**
 * Forgot password, step 1. Always 200 with the SAME body, and the response is
 * flushed BEFORE any lookup/OTP/Telegram work runs — so neither the body nor the
 * response time reveals whether the NIM exists or has Telegram linked.
 */
router.post('/forgot-password', (req, res) => {
  res.json({ message: OTP_MAYBE_SENT });
  passwordResetService
    .requestReset(req.body && req.body.nim)
    .catch((err) => console.error('[forgot-password] requestReset failed', err));
});

/**
 * Forgot password, step 2. Verify OTP + set the new password. Every auth failure
 * (unknown NIM, wrong/expired/absent OTP, throttled) collapses to one identical
 * 400; only a weak new password gets a distinct message (the caller already
 * proved a valid OTP, so it's not an enumeration oracle).
 */
router.post('/reset-password', async (req, res) => {
  const { nim, otp, newPassword } = req.body || {};
  const result = await passwordResetService.completeReset(nim, otp, newPassword);
  if (result.ok) return res.json({ message: 'Password berhasil diganti. Silakan login.' });
  if (result.reason === 'weak') {
    return res.status(400).json({ error: 'Password baru minimal 8 karakter dan tidak boleh sama dengan NIM.' });
  }
  return res.status(400).json({ error: 'OTP salah atau sudah kadaluarsa.' });
});

module.exports = router;

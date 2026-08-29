const express = require('express');
const { requireInstruktur } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();
router.use(requireInstruktur);

/** List instruktur + asisten accounts. */
router.get('/', async (req, res) => {
  res.json(await User.listStaff());
});

/** Create (or upsert) a staff account. instruktur only. */
router.post('/', async (req, res) => {
  const { nim, name, password, role } = req.body;
  if (!['instruktur', 'asisten'].includes(role)) {
    return res.status(400).json({ error: 'role harus instruktur atau asisten' });
  }
  if (!nim || !password) {
    return res.status(400).json({ error: 'nim dan password wajib diisi' });
  }
  res.status(201).json(await User.createStaff({ nim, name, password, role }));
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  }
  const target = await User.findById(id);
  if (!target || !['instruktur', 'asisten'].includes(target.role)) {
    return res.status(404).json({ error: 'Akun staf tidak ditemukan' });
  }
  if (target.role === 'instruktur') {
    const { count } = await User.countInstruktur();
    if (count <= 1) return res.status(400).json({ error: 'Minimal harus ada satu instruktur' });
  }
  await User.removeStaff(id);
  res.json({ ok: true });
});

module.exports = router;

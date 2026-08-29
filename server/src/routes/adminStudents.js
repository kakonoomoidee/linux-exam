const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { requireStaff } = require('../middleware/auth');
const User = require('../models/User');
const { normalizeKelas } = require('../lib/kelas');
const { importStudentsFromFile } = require('../services/importService');

const router = express.Router();
router.use(requireStaff); // instruktur + asisten — same tier that adds session participants

const upload = multer({ dest: path.join(__dirname, '../../data/uploads') });

const TEMPLATE_COLUMNS = ['NIM', 'Nama', 'Kelas'];
const TEMPLATE_ROWS = [
  { NIM: '20220140055', Nama: 'Budi Santoso', Kelas: 'A' },
  { NIM: '20220140056', Nama: 'Siti Rahma', Kelas: 'B' },
];

// Global roster: every student, grouped/paginated client-side.
// ponytail: full-table read; add server paging if the roster ever passes a few thousand.
router.get('/', async (req, res) => {
  res.json(await User.listStudents());
});

// Downloadable .xlsx template. GET so a plain <a download> works; auth via ?token=.
router.get('/template.xlsx', (req, res) => {
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS, { header: TEMPLATE_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mahasiswa');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename=template-mahasiswa.xlsx');
  res.send(buf);
});

// Bulk roster import (columns: NIM, Nama, Kelas). Upserts via findOrCreateStudent —
// creates missing rows, backfills name/kelas only where currently NULL.
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file wajib diupload (field name: file)' });
  try {
    res.json(await importStudentsFromFile(req.file.path));
  } catch (err) {
    console.error('[adminStudents] import failed', err);
    res.status(500).json({ error: 'Gagal membaca file Excel', detail: err.message });
  }
});

// Staff correction of a student's name / kelas ("fix it later" path for the
// migration's nulled kelas rows).
router.patch('/:id', async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target || target.role !== 'student') {
    return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  }

  const fields = {};
  if (req.body.name !== undefined) fields.name = String(req.body.name).trim() || null;
  if (req.body.kelas !== undefined) {
    const raw = String(req.body.kelas).trim();
    if (raw === '') {
      fields.kelas = null;
    } else {
      const kelas = normalizeKelas(raw);
      if (kelas === null) return res.status(400).json({ error: 'kelas harus satu huruf A–F' });
      fields.kelas = kelas;
    }
  }

  res.json(await User.updateStudent(target.id, fields));
});

module.exports = router;

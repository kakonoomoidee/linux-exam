const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { requireStaff } = require('../middleware/auth');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { normalizeKelas } = require('../lib/kelas');
const { importStudentsFromFile } = require('../services/importService');

const router = express.Router();
router.use(requireStaff); // instruktur + asisten — same tier that adds session participants

const upload = multer({ dest: path.join(__dirname, '../../data/uploads') });

const TEMPLATE_COLUMNS = ['NIM', 'Nama', 'Kelas', 'Telegram Username', 'Telegram Chat ID'];
const TEMPLATE_ROWS = [
  { NIM: '20220140055', Nama: 'Budi Santoso', Kelas: 'A', 'Telegram Username': 'budisan', 'Telegram Chat ID': '' },
  { NIM: '20220140056', Nama: 'Siti Rahma', Kelas: 'B', 'Telegram Username': '', 'Telegram Chat ID': '' },
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
    res.json(await importStudentsFromFile(req.file.path, req.user.id));
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
      if (kelas === null) return res.status(400).json({ error: 'format kelas tidak valid (huruf/angka, maks 12 karakter)' });
      fields.kelas = kelas;
    }
  }
  if (req.body.telegram_username !== undefined) {
    fields.telegram_username = String(req.body.telegram_username).trim().replace(/^@/, '') || null;
  }
  if (req.body.telegram_chat_id !== undefined) {
    const raw = String(req.body.telegram_chat_id).trim();
    if (raw !== '' && !/^-?\d+$/.test(raw)) {
      return res.status(400).json({ error: 'Telegram Chat ID harus berupa angka' });
    }
    fields.telegram_chat_id = raw || null;
  }

  const telegramChanged =
    (fields.telegram_username !== undefined && (fields.telegram_username || null) !== (target.telegram_username || null)) ||
    (fields.telegram_chat_id !== undefined && (fields.telegram_chat_id || null) !== (target.telegram_chat_id || null));

  const updated = await User.updateStudent(target.id, fields);

  if (telegramChanged) {
    AuditLog.record({
      actorType: 'staff',
      actorId: req.user.id,
      action: 'telegram_bind_staff_override',
      targetUserId: target.id,
      metadata: {
        source: 'edit_modal',
        chat_id: fields.telegram_chat_id !== undefined ? fields.telegram_chat_id : target.telegram_chat_id || null,
        telegram_username:
          fields.telegram_username !== undefined ? fields.telegram_username : target.telegram_username || null,
        previous_chat_id: target.telegram_chat_id || null,
      },
    }).catch((err) => console.error('[audit] telegram_bind_staff_override', err));
  }

  res.json(updated);
});

module.exports = router;

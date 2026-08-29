const express = require('express');
const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');
const { requireStaff, requireInstruktur } = require('../middleware/auth');
const Question = require('../models/Question');
const { importFromFile } = require('../services/importService');

const router = express.Router();

const upload = multer({ dest: path.join(__dirname, '../../data/uploads') });

// Column format for both the Excel import and the downloadable template.
const TEMPLATE_COLUMNS = [
  'ucp',
  'order',
  'story_id',
  'story_en',
  'point',
  'level',
  'check_type',
  'accepted_patterns',
  'state_checker',
];
const TEMPLATE_ROWS = [
  {
    ucp: 1,
    order: 1,
    story_id: 'Tampilkan isi file "catatan.txt" ke layar.',
    story_en: 'Print the contents of the file "catatan.txt" to the screen.',
    point: 1,
    level: 'easy',
    check_type: 'command_match',
    accepted_patterns: '^cat\\s+catatan\\.txt$ | ^less\\s+catatan\\.txt$',
    state_checker: '',
  },
  {
    ucp: 1,
    order: 2,
    story_id: 'Buat folder bernama "arsip" di direktori home kamu.',
    story_en: 'Create a folder named "arsip" in your home directory.',
    point: 2,
    level: 'medium',
    check_type: 'both',
    accepted_patterns: '^mkdir\\s+(-p\\s+)?~?/?arsip$',
    state_checker: 'test -d ~/arsip && echo PASS || echo FAIL',
  },
  {
    ucp: 2,
    order: 1,
    story_id: 'Ubah permission "rahasia.txt" menjadi hanya bisa dibaca owner (600).',
    story_en: 'Change the permission of "rahasia.txt" so only the owner can read it (600).',
    point: 3,
    level: 'hard',
    check_type: 'state_check',
    accepted_patterns: '',
    state_checker: '[ "$(stat -c %a ~/rahasia.txt 2>/dev/null)" = "600" ] && echo PASS || echo FAIL',
  },
];

// --- Question bank: read (any staff) ---

// ?ucp=1|2 segments the bank; omitted = every UCP (review dropdown still wants all).
const ucpParam = (q) => ([1, 2].includes(Number(q)) ? Number(q) : null);

router.get('/variant/:variantIndex', requireStaff, async (req, res) => {
  res.json(
    await Question.listForVariantIndex(parseInt(req.params.variantIndex, 10), ucpParam(req.query.ucp))
  );
});

// All questions across all variants, for the review dropdown + the Bank Soal list
router.get('/', requireStaff, async (req, res) => {
  const ucp = ucpParam(req.query.ucp);
  const all = [];
  for (let v = 0; v <= 9; v++) all.push(...(await Question.listForVariantIndex(v, ucp)));
  res.json(all);
});

// --- Question bank: mutations + import + template (instruktur only) ---

// Downloadable .xlsx template so the import column format is unambiguous.
// GET so a plain <a download> works; auth via ?token= (see middleware/auth.js).
router.get('/template.xlsx', requireInstruktur, (req, res) => {
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_ROWS, { header: TEMPLATE_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Variant 0'); // ucp column drives the split, not the sheet
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename=template-bank-soal.xlsx');
  res.send(buf);
});

// Upload the master Excel question bank (one sheet per variant, see importService.js)
router.post('/import', requireInstruktur, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file wajib diupload (field name: file)' });
  try {
    const result = await importFromFile(req.file.path);
    res.json(result);
  } catch (err) {
    console.error('[adminQuestions] import failed', err);
    res.status(500).json({ error: 'Gagal membaca file Excel', detail: err.message });
  }
});

router.post('/', requireInstruktur, async (req, res) => {
  const { variant_index, order_index, story_text } = req.body;
  if (variant_index === undefined || Number.isNaN(parseInt(variant_index, 10))) {
    return res.status(400).json({ error: 'variant_index wajib diisi (0-9)' });
  }
  if (!story_text || !String(story_text).trim()) {
    return res.status(400).json({ error: 'story_text wajib diisi' });
  }
  const created = await Question.create({
    variant_index: parseInt(variant_index, 10),
    order_index: parseInt(order_index, 10) || 1,
    story_text: String(story_text).trim(),
    story_text_en: req.body.story_text_en ? String(req.body.story_text_en).trim() : null,
    point: req.body.point,
    check_type: req.body.check_type,
    accepted_patterns: req.body.accepted_patterns,
    state_checker_script: req.body.state_checker_script,
    level: req.body.level,
    ucp: Number(req.body.ucp) === 2 ? 2 : 1,
  });
  res.status(201).json(created);
});

router.patch('/:id', requireInstruktur, async (req, res) => {
  const existing = await Question.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Soal tidak ditemukan' });
  res.json(await Question.update(req.params.id, req.body));
});

router.delete('/:id', requireInstruktur, async (req, res) => {
  const existing = await Question.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Soal tidak ditemukan' });
  await Question.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const Question = require('../models/Question');
const { importFromFile } = require('../services/importService');

const router = express.Router();
router.use(requireAdmin);

const upload = multer({ dest: path.join(__dirname, '../../data/uploads') });

// Upload the master Excel question bank (one tab per variant, see importService.js for the column format)
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file wajib diupload (field name: file)' });
  try {
    const result = await importFromFile(req.file.path);
    res.json(result);
  } catch (err) {
    console.error('[adminQuestions] import failed', err);
    res.status(500).json({ error: 'Gagal membaca file Excel', detail: err.message });
  }
});

router.get('/variant/:variantIndex', async (req, res) => {
  res.json(await Question.listForVariantIndex(parseInt(req.params.variantIndex, 10)));
});

// All questions across all variants, for populating the review dashboard's dropdown
router.get('/', async (req, res) => {
  const all = [];
  for (let v = 0; v <= 9; v++) all.push(...(await Question.listForVariantIndex(v)));
  res.json(all);
});

module.exports = router;

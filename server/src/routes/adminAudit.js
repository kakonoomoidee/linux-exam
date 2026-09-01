const express = require('express');
const { requireInstruktur } = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');

const router = express.Router();
// Oversight data (who logged in when, who changed what) — instruktur-only, same
// tier as the "Staf" page.
router.use(requireInstruktur);

const PAGE_SIZE = 50;

// GET /api/admin/audit?nim=&action=&from=&to=&page=
router.get('/', async (req, res) => {
  const { nim, action, from, to, page } = req.query;
  const result = await AuditLog.list({
    nim: nim ? String(nim).trim() : undefined,
    action: action ? String(action).trim() : undefined,
    from: from ? String(from).trim() : undefined,
    to: to ? String(to).trim() : undefined,
    page: page ? parseInt(page, 10) : 1,
    pageSize: PAGE_SIZE,
  });
  res.json(result);
});

// Distinct action strings, for the filter dropdown.
router.get('/actions', async (req, res) => {
  const rows = await AuditLog.actions();
  res.json(rows.map((r) => r.action));
});

module.exports = router;

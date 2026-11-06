/**
 * Review Nilai v2 — session list, per-session student list + summary,
 * per-student side-by-side review, corrections, and grade export.
 * Every route is staff-only (instruktur + asisten); students get 403.
 */
const express = require('express');
const { requireStaff } = require('../middleware/auth');
const reviewService = require('../services/reviewService');
const exportService = require('../services/exportService');
const { ALLOWED_PERCENTS, isAllowedPercent } = require('../services/gradeService');

const router = express.Router();
router.use(requireStaff);

const MAX_NOTE_LENGTH = 1000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HttpStatus = Object.freeze({ BAD_REQUEST: 400, NOT_FOUND: 404 });

/** Maps the service's not-found error to a 404; anything else goes to the global handler. */
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (!(err instanceof reviewService.ReviewNotFoundError)) throw err;
    res.status(HttpStatus.NOT_FOUND).json({ error: err.message });
  }
};

const isPositiveId = (v) => /^\d+$/.test(String(v));
const requireIds = (...names) => (req, res, next) => {
  const bad = names.find((n) => !isPositiveId(req.params[n]));
  if (bad) return res.status(HttpStatus.BAD_REQUEST).json({ error: `${bad} tidak valid` });
  next();
};

router.get('/sessions', handle(async (req, res) => {
  res.json({ sessions: await reviewService.listSessions() });
}));

router.get('/sessions/:sessionId', requireIds('sessionId'), handle(async (req, res) => {
  res.json(await reviewService.sessionOverview(req.params.sessionId));
}));

router.get('/participants/:participantId', requireIds('participantId'), handle(async (req, res) => {
  res.json(await reviewService.participantDetail(req.params.participantId));
}));

/** Body: { percent: 0|25|50|75|100, note?: string }. Records who + when. */
router.put('/participants/:participantId/questions/:questionId/correction',
  requireIds('participantId', 'questionId'),
  handle(async (req, res) => {
    const { percent, note } = req.body || {};
    if (!isAllowedPercent(percent)) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: `percent harus salah satu dari ${ALLOWED_PERCENTS.join(', ')}` });
    }
    if (note != null && (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH)) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: `catatan maksimal ${MAX_NOTE_LENGTH} karakter` });
    }
    const saved = await reviewService.saveCorrection({
      participantId: req.params.participantId,
      questionId: req.params.questionId,
      percent,
      note: note ? note.trim() : null,
      reviewerId: req.user.id,
    });
    res.json(saved);
  }));

router.delete('/participants/:participantId/questions/:questionId/correction',
  requireIds('participantId', 'questionId'),
  handle(async (req, res) => {
    res.json(await reviewService.clearCorrection({
      participantId: req.params.participantId,
      questionId: req.params.questionId,
      reviewerId: req.user.id,
    }));
  }));

// --- export (plain <a download> links: auth may come via ?token=, see middleware/auth.js) ---

function sendFile(res, { name, type, body }) {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(body);
}

router.get('/sessions/:sessionId/export.csv', requireIds('sessionId'), handle(async (req, res) => {
  const { session, analyses } = await reviewService.analyzeSession(req.params.sessionId);
  const isDetail = req.query.detail === '1';
  const table = isDetail ? exportService.detailTable(analyses) : exportService.summaryTable(analyses);
  sendFile(res, {
    name: exportService.exportFileName(session, 'csv', isDetail ? '_detail' : ''),
    type: 'text/csv; charset=utf-8',
    body: exportService.toCsv(table),
  });
}));

router.get('/sessions/:sessionId/export.xlsx', requireIds('sessionId'), handle(async (req, res) => {
  const { session, analyses } = await reviewService.analyzeSession(req.params.sessionId);
  sendFile(res, {
    name: exportService.exportFileName(session, 'xlsx'),
    type: XLSX_MIME,
    body: exportService.toXlsx([
      ['Nilai', exportService.summaryTable(analyses)],
      ['Detail', exportService.detailTable(analyses)],
    ]),
  });
}));

module.exports = router;

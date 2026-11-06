/**
 * "Nilai akhir" export for one session: CSV (UTF-8 BOM so Excel opens it with
 * the right encoding), a per-question detail CSV, and an XLSX with both as
 * sheets. Built from reviewService.analyzeSession() + gradeService, the same
 * functions the review pages use.
 */
const XLSX = require('xlsx');
const { effectiveScore, isReviewed, percentForScore, REVIEW_STATUS } = require('./gradeService');

const UTF8_BOM = '﻿';
const EXPORT_TIME_ZONE = 'Asia/Jakarta'; // campus time; file names + "waktu koreksi" use it
const MAX_SLUG_LENGTH = 60;
const STATUS_TEXT = Object.freeze({
  [REVIEW_STATUS.DONE]: 'Sudah dikoreksi',
  [REVIEW_STATUS.PARTIAL]: 'Sebagian',
  [REVIEW_STATUS.PENDING]: 'Belum dikoreksi',
});
const DETAIL_HEADERS = [
  'NIM', 'Nama', 'Kelas', 'Varian', 'No Soal', 'ID Soal', 'Point', 'Jawaban yang dinilai', 'Auto-grade',
  'Skor auto', 'Koreksi (%)', 'Skor final', 'Deteksi', 'Catatan', 'Dikoreksi oleh', 'Waktu koreksi',
];

const byNim = (a, b) => String(a.participant.nim).localeCompare(String(b.participant.nim));
const maxOrder = (analyses) => Math.max(0, ...analyses.flatMap((a) => a.rows.map((r) => r.question.order_index)));

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: EXPORT_TIME_ZONE, dateStyle: 'short', timeStyle: 'medium' })
    .format(new Date(value));
}

/** `nilai_<session-name-slug>_<YYYY-MM-DD>.<ext>`, date = exam start (or creation). */
function exportFileName(session, ext, suffix = '') {
  const slug = String(session.name || `sesi-${session.id}`)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH) || `sesi-${session.id}`;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: EXPORT_TIME_ZONE }).format(
    new Date(session.started_at || session.created_at || Date.now())
  );
  return `nilai_${slug}_${date}${suffix}.${ext}`;
}

/** One row per participant (sorted by NIM): per-question final scores + totals. */
function summaryTable(analyses) {
  const questionCount = maxOrder(analyses);
  const header = ['No', 'NIM', 'Nama', 'Kelas', 'Varian',
    ...Array.from({ length: questionCount }, (_, i) => `Soal ${i + 1}`),
    'Skor auto total', 'Skor final total', 'Skor maksimum', 'Nilai akhir (0-100)', 'Status koreksi'];
  const rows = [...analyses].sort(byNim).map((a, i) => {
    const byOrder = new Map(a.rows.map((r) => [r.question.order_index, effectiveScore(r.submission)]));
    return [i + 1, a.participant.nim, a.participant.name || '', a.participant.kelas || '', a.participant.variant_index,
      ...Array.from({ length: questionCount }, (_, q) => (byOrder.has(q + 1) ? byOrder.get(q + 1) : '')),
      a.scores.autoTotal, a.scores.finalTotal, a.scores.maxTotal, a.scores.finalGrade, STATUS_TEXT[a.scores.status]];
  });
  return [header, ...rows];
}

function gradedCommand(row, commandsById) {
  const id = row.submission?.matched_command_log_id ?? row.detection.candidateLogId;
  return id && commandsById.has(id) ? commandsById.get(id).raw_command : '';
}

/** One row per participant x question with the correction trail. */
function detailTable(analyses) {
  const rows = [];
  for (const a of [...analyses].sort(byNim)) {
    const commandsById = new Map(a.commands.map((c) => [c.id, c]));
    for (const r of a.rows) {
      const sub = r.submission;
      rows.push([a.participant.nim, a.participant.name || '', a.participant.kelas || '', a.participant.variant_index,
        r.question.order_index, r.question.id, r.question.point, gradedCommand(r, commandsById),
        sub?.auto_result || 'unmatched', Number(sub?.auto_score ?? 0),
        isReviewed(sub) ? percentForScore(sub.final_score, r.question.point) : '', effectiveScore(sub),
        r.detection.label, sub?.review_note || '', isReviewed(sub) ? sub.reviewer_name || '' : '',
        isReviewed(sub) ? formatDateTime(sub.reviewed_at) : '']);
    }
  }
  return [DETAIL_HEADERS, ...rows];
}

/**
 * CSV cell: quoted when needed, and text that a spreadsheet would run as a
 * formula (=, +, -, @ prefix — e.g. a student's command) is prefixed with '.
 */
function csvCell(value) {
  if (typeof value === 'number') return String(value);
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(table) {
  return UTF8_BOM + table.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function toXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, table] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(table), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { exportFileName, summaryTable, detailTable, toCsv, toXlsx, csvCell, STATUS_TEXT };

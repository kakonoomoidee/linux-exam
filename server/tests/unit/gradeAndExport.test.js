const XLSX = require('xlsx');
const grade = require('../../src/services/gradeService');
const exportService = require('../../src/services/exportService');

const row = (point, sub) => ({ question: { point }, submission: sub });

describe('gradeService', () => {
  test('effectiveScore: manual correction wins, else auto, else 0', () => {
    expect(grade.effectiveScore({ auto_score: 20, final_score: 5 })).toBe(5);
    expect(grade.effectiveScore({ auto_score: 20, final_score: 0 })).toBe(0); // 0% is a real correction
    expect(grade.effectiveScore({ auto_score: 20, final_score: null })).toBe(20);
    expect(grade.effectiveScore(null)).toBe(0);
  });

  test.each([[0, true], [25, true], [100, true], [30, false], ['50', false], [null, false], [0.5, false]])(
    'isAllowedPercent(%p) -> %p', (p, ok) => expect(grade.isAllowedPercent(p)).toBe(ok));

  test('scoreForPercent / percentForScore round-trip on odd points', () => {
    expect(grade.scoreForPercent(75, 3)).toBe(2.25);
    expect(grade.percentForScore(2.25, 3)).toBe(75);
    expect(grade.percentForScore(1, 0)).toBe(0);
  });

  test('summarizeScores: totals, 0-100 grade and review status', () => {
    const rows = [
      row(20, { auto_result: 'pass', auto_score: 20, final_score: null }),
      row(20, { auto_result: 'fail', auto_score: 0, final_score: 15 }),
      row(10, null), // never attempted
    ];
    expect(grade.summarizeScores(rows)).toEqual({
      autoTotal: 20, finalTotal: 35, maxTotal: 50, finalGrade: 70, reviewedCount: 1, status: 'partial',
    });
  });

  test.each([
    ['every question passed', [row(1, { auto_result: 'pass', auto_score: 1 })], 'done'],
    ['all non-pass reviewed', [row(1, { auto_result: 'fail', auto_score: 0, final_score: 0 })], 'done'],
    ['nothing reviewed', [row(1, { auto_result: 'fail', auto_score: 0 }), row(1, null)], 'pending'],
  ])('status: %s', (_n, rows, status) => {
    expect(grade.summarizeScores(rows).status).toBe(status);
  });

  test('no questions -> grade 0, not NaN', () => {
    expect(grade.summarizeScores([]).finalGrade).toBe(0);
  });
});

describe('exportService', () => {
  const analysis = (nim, name, rows, scores) => ({
    participant: { nim, name, kelas: 'A', variant_index: Number(nim.slice(-1)) },
    rows,
    commands: [{ id: 1, raw_command: '=HYPERLINK("x")' }],
    scores,
  });
  const q = (order, point = 20) => ({ id: order, order_index: order, point });
  const analyses = [
    analysis('9999000021', 'Zed', [{ question: q(1), submission: { auto_result: 'fail', auto_score: 0, final_score: 15,
      reviewer_name: 'Asisten', reviewed_at: '2026-11-03T02:00:00Z', review_note: 'ok' }, detection: { label: 'near_miss', candidateLogId: 1 } }],
    grade.summarizeScores([row(20, { auto_result: 'fail', auto_score: 0, final_score: 15 })])),
    analysis('9999000010', 'Ana, "A"', [{ question: q(1), submission: { auto_result: 'pass', auto_score: 20, matched_command_log_id: 1 },
      detection: { label: 'correct' } }], grade.summarizeScores([row(20, { auto_result: 'pass', auto_score: 20 })])),
  ];

  test('summary table: sorted by NIM, per-question final scores, totals and status text', () => {
    const [header, first, second] = exportService.summaryTable(analyses);
    expect(header).toEqual(['No', 'NIM', 'Nama', 'Kelas', 'Varian', 'Soal 1', 'Skor auto total', 'Skor final total',
      'Skor maksimum', 'Nilai akhir (0-100)', 'Status koreksi']);
    expect(first).toEqual([1, '9999000010', 'Ana, "A"', 'A', 0, 20, 20, 20, 20, 100, 'Sudah dikoreksi']);
    expect(second).toEqual([2, '9999000021', 'Zed', 'A', 1, 15, 0, 15, 20, 75, 'Sudah dikoreksi']);
  });

  test('detail table carries the correction trail', () => {
    const [, , zed] = exportService.detailTable(analyses);
    expect(zed).toEqual(['9999000021', 'Zed', 'A', 1, 1, 1, 20, '=HYPERLINK("x")', 'fail', 0, 75, 15, 'near_miss', 'ok',
      'Asisten', '2026-11-03 09:00:00']);
  });

  test('CSV: UTF-8 BOM, CRLF, quoting, and formula injection neutralised', () => {
    const csv = exportService.toCsv(exportService.detailTable(analyses));
    expect(csv.startsWith('﻿NIM,')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.split('\r\n').length).toBe(4); // header + 2 rows + trailing
    expect(exportService.csvCell('Ana, "A"')).toBe('"Ana, ""A"""');
    expect(exportService.csvCell(-1)).toBe('-1'); // numbers are never prefixed
  });

  test('file name: nilai_<slug>_<date in campus time>', () => {
    expect(exportService.exportFileName({ id: 3, name: '[DEMO] UCP 1 — Kelas A', started_at: '2026-11-03T18:00:00Z' }, 'csv'))
      .toBe('nilai_demo-ucp-1-kelas-a_2026-11-04.csv'); // 18:00Z = 01:00 WIB next day
    expect(exportService.exportFileName({ id: 3, name: '!!!', created_at: '2026-01-02T00:00:00Z' }, 'xlsx', '_x'))
      .toBe('nilai_sesi-3_2026-01-02_x.xlsx');
  });

  test('XLSX has both sheets', () => {
    const buf = exportService.toXlsx([['Nilai', exportService.summaryTable(analyses)], ['Detail', exportService.detailTable(analyses)]]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Nilai', 'Detail']);
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Nilai, { header: 1 })[1][1]).toBe('9999000010');
  });
});

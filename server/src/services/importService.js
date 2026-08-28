const XLSX = require('xlsx');
const Question = require('../models/Question');

/**
 * Expected column headers per row (case-insensitive, order doesn't matter):
 *   variant        - optional; 0-9. If omitted, inferred from sheet name (see below).
 *   order          - question order within the variant (1, 2, 3...)
 *   story          - the soal cerita text shown to the student
 *   point          - numeric weight of this question (default 1)
 *   check_type     - "command_match" | "state_check" | "both" (default command_match)
 *   accepted_patterns - one or more regex patterns, separated by " | " (pipe with spaces)
 *   state_checker  - bash script text (only needed for state_check/both)
 *
 * Sheet-name -> variant inference: if a row has no "variant" column, the sheet
 * name is scanned for a trailing digit (e.g. "Variant 3", "NIM akhir 7") and
 * that digit is used for every row in that sheet.
 */
function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath);
  const allQuestions = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (rows.length === 0) continue;

    const sheetVariantMatch = sheetName.match(/(\d)(?!.*\d)/);
    const sheetVariant = sheetVariantMatch ? parseInt(sheetVariantMatch[1], 10) : null;

    rows.forEach((row, idx) => {
      const normalizedRow = normalizeRowKeys(row);
      const variantIndex = normalizedRow.variant !== undefined && normalizedRow.variant !== ''
        ? parseInt(normalizedRow.variant, 10)
        : sheetVariant;

      if (variantIndex === null || Number.isNaN(variantIndex)) {
        console.warn(`[import] skipping row ${idx + 2} in sheet "${sheetName}": no variant found`);
        return;
      }

      const patterns = String(normalizedRow.accepted_patterns || '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);

      allQuestions.push({
        variant_index: variantIndex,
        order_index: parseInt(normalizedRow.order || idx + 1, 10),
        story_text: String(normalizedRow.story || '').trim(),
        point: parseFloat(normalizedRow.point || 1),
        check_type: normalizedRow.check_type || 'command_match',
        accepted_patterns: patterns,
        state_checker_script: normalizedRow.state_checker || null,
        _sheet: sheetName,
      });
    });
  }

  return allQuestions;
}

function normalizeRowKeys(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    out[key.trim().toLowerCase().replace(/\s+/g, '_')] = row[key];
  }
  return out;
}

async function importFromFile(filePath) {
  const questions = parseWorkbook(filePath);
  const created = [];
  const errors = [];

  for (const q of questions) {
    if (!q.story_text) {
      errors.push({ ...q, error: 'story_text kosong' });
      continue;
    }
    try {
      created.push(await Question.create(q));
    } catch (err) {
      errors.push({ ...q, error: err.message });
    }
  }

  return { totalRows: questions.length, created: created.length, errors };
}

module.exports = { parseWorkbook, importFromFile };

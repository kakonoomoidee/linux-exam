const XLSX = require('xlsx');
const Question = require('../models/Question');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { normalizeKelas } = require('../lib/kelas');

/**
 * Expected column headers per row (case-insensitive, order doesn't matter):
 *   variant        - optional; 0-9. If omitted, inferred from sheet name (see below).
 *   order          - question order within the variant (1, 2, 3...)
 *   story / story_id - the soal cerita text shown to the student (Indonesian)
 *   story_en       - optional English translation (may be blank)
 *   point          - numeric weight of this question (default 1)
 *   level          - "easy" | "medium" | "hard" (default medium; unknown -> medium)
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

      const level = ['easy', 'medium', 'hard'].includes(String(normalizedRow.level || '').toLowerCase())
        ? String(normalizedRow.level).toLowerCase()
        : 'medium';

      const ucpRaw = String(normalizedRow.ucp ?? '').trim();

      allQuestions.push({
        variant_index: variantIndex,
        order_index: parseInt(normalizedRow.order || idx + 1, 10),
        story_text: String(normalizedRow.story_id || normalizedRow.story || '').trim(),
        story_text_en: String(normalizedRow.story_en || '').trim() || null,
        point: parseFloat(normalizedRow.point || 1),
        level,
        check_type: normalizedRow.check_type || 'command_match',
        accepted_patterns: patterns,
        state_checker_script: normalizedRow.state_checker || null,
        ucp: ucpRaw === '' ? 1 : parseInt(ucpRaw, 10),
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
    if (![1, 2].includes(q.ucp)) {
      errors.push({ ...q, error: 'ucp harus 1 atau 2' });
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

/**
 * Global student roster import. Columns (case-insensitive): NIM, Nama, Kelas,
 * Telegram Username, Telegram Chat ID (the last two optional).
 * Reuses User.findOrCreateStudent — creates missing students (password = NIM,
 * forced change on first login) and backfills name/kelas/telegram ONLY where the
 * current value is NULL, never overwriting data staff or the student already set.
 * Invalid kelas (not A–F after normalization) is reported, not silently dropped.
 * A newly-set Telegram binding writes a telegram_bind_staff_override audit row.
 */
async function importStudentsFromFile(filePath, actorId = null) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [];

  let created = 0;
  let backfilled = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = normalizeRowKeys(rows[i]);
    const nim = String(r.nim || '').trim();
    const name = String(r.nama || r.name || '').trim() || null;
    const kelasRaw = String(r.kelas || '').trim();
    const tgUser = String(r.telegram_username || '').trim().replace(/^@/, '') || null;
    const tgChat = String(r.telegram_chat_id || '').trim() || null;

    if (!nim) {
      errors.push({ row: i + 2, error: 'NIM kosong' });
      continue;
    }
    let kelas = null;
    if (kelasRaw !== '') {
      kelas = normalizeKelas(kelasRaw);
      if (kelas === null) {
        errors.push({ row: i + 2, nim, kelas: kelasRaw, error: 'format kelas tidak valid (huruf/angka, maks 12 karakter)' });
        continue;
      }
    }
    if (tgChat && !/^-?\d+$/.test(tgChat)) {
      errors.push({ row: i + 2, nim, error: 'Telegram Chat ID harus berupa angka' });
      continue;
    }

    const before = await User.findByNim(nim);
    await User.findOrCreateStudent(nim, name, kelas, { username: tgUser, chatId: tgChat });
    if (!before) created++;
    else if ((name && !before.name) || (kelas && !before.kelas)) backfilled++;

    const boundNow =
      (tgChat && !(before && before.telegram_chat_id)) || (tgUser && !(before && before.telegram_username));
    if (boundNow) {
      await AuditLog.record({
        actorType: 'staff',
        actorId,
        action: 'telegram_bind_staff_override',
        targetUserId: (await User.findByNim(nim)).id,
        metadata: {
          source: 'excel_import',
          chat_id: tgChat,
          telegram_username: tgUser,
          previous_chat_id: (before && before.telegram_chat_id) || null,
        },
      }).catch((err) => console.error('[audit] telegram_bind_staff_override (import)', err));
    }
  }

  return { totalRows: rows.length, created, backfilled, errors };
}

module.exports = { parseWorkbook, importFromFile, importStudentsFromFile };

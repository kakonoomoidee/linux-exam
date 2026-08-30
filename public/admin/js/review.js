const LEVEL_TONE = { easy: 'green', medium: 'amber', hard: 'red' };
const levelBadge = (level) =>
  window.ui.pill(t('admin.level.' + (level || 'medium')) || level || 'medium', LEVEL_TONE[level] || 'amber');

let reviewMode = 'sesi'; // 'sesi' (per-question) | 'kelas' (whole-kelas read) | 'mhs' (one student, all questions)
let kelasGroups = null; // last Per Kelas payload, for the per-row command lookup

// Per Mahasiswa view state — a roster (from /grades, sorted like the "Mahasiswa
// & Nilai" tab) plus a cursor, so ◀/▶ walk students without touching the dropdown.
let mhsRoster = [];
let mhsIndex = -1;
let mhsData = null; // last /participants/:id payload { participant, submissions, total }
let mhsDelegBound = false;

// Per Kelas view UI state — persisted across the i18n:changed / bulk-accept full
// re-renders so a language toggle mid-review doesn't lose your place. Reset only
// when the session or kelas actually changes (see lastKelasKey).
let lastKelasKey = null;
let kelasSearchQuery = '';
const expandedCards = new Set(); // qids the user opened via "Tampilkan semua"
const collapsedVariants = new Set(); // variant_index (string) the user folded
let searchForcedCards = new Set(); // qids a live search forced open — transient
let kelasSearchTimer = null;
let kelasDelegBound = false;

const cssEsc = (v) => (window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v));

const checkLabel = (ct) =>
  ct === 'state_check' ? t('admin.stateCheckLabel') : ct === 'both' ? t('admin.bothCheckLabel') : t('admin.acceptedPatternsLabel');
const patterns = (raw) => {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return arr.join('  |  ');
  } catch {
    return '';
  }
};

async function loadReviewSessionOptions() {
  const sessions = await apiFetch('/admin/sessions');
  const sel = document.getElementById('review-session-select');
  sel.innerHTML = sessions
    .map((s) => `<option value="${s.id}">${s.name} — UCP ${s.ucp ?? 1}</option>`)
    .join('');

  const questions = await apiFetch('/admin/questions');
  const qSel = document.getElementById('review-question-select');
  qSel.innerHTML = questions
    .map(
      (q) =>
        `<option value="${q.id}">[${(q.level || 'medium').toUpperCase()}] UCP${q.ucp ?? 1} V${q.variant_index ?? '?'} #${q.order_index} - ${q.story_text.slice(0, 32)}...</option>`
    )
    .join('');

  if (reviewMode === 'kelas') await populateKelasOptions();
  if (reviewMode === 'mhs') await populateMhsRoster();
}
window.loadReviewSessionOptions = loadReviewSessionOptions;

// --- mode toggle ---
function setReviewMode(mode) {
  reviewMode = mode;
  for (const m of ['sesi', 'kelas', 'mhs']) {
    const b = document.getElementById('review-mode-' + m);
    const on = mode === m;
    b.classList.toggle('btn-primary', on);
    b.classList.toggle('btn-ghost', !on);
    b.setAttribute('aria-pressed', String(on));
  }
  document.getElementById('review-question-select').classList.toggle('hidden', mode !== 'sesi');
  document.getElementById('review-bulk-accept-btn').classList.toggle('hidden', mode !== 'sesi');
  document.getElementById('review-kelas-select').classList.toggle('hidden', mode !== 'kelas');
  document.getElementById('review-kelas-search').classList.toggle('hidden', mode !== 'kelas');
  document.getElementById('review-mhs-select').classList.toggle('hidden', mode !== 'mhs');
  if (mode !== 'kelas') document.getElementById('review-kelas-search-empty').classList.add('hidden');
  document.getElementById('review-table').innerHTML = '';
  if (mode === 'kelas') populateKelasOptions();
  if (mode === 'mhs') populateMhsRoster();
}
document.getElementById('review-mode-sesi').addEventListener('click', () => setReviewMode('sesi'));
document.getElementById('review-mode-kelas').addEventListener('click', () => setReviewMode('kelas'));
document.getElementById('review-mode-mhs').addEventListener('click', () => setReviewMode('mhs'));

async function populateKelasOptions() {
  const sessionId = document.getElementById('review-session-select').value;
  const sel = document.getElementById('review-kelas-select');
  if (!sessionId) {
    sel.innerHTML = '';
    return;
  }
  const { kelas } = await apiFetch(`/admin/review/sessions/${sessionId}/kelas`);
  sel.innerHTML = kelas.length
    ? kelas.map((k) => `<option value="${k}">${t('common.kelas')} ${k}</option>`).join('')
    : `<option value="">${t('admin.reviewNoKelas')}</option>`;
}

document.getElementById('review-load-btn').addEventListener('click', () => {
  if (reviewMode === 'kelas') return loadReviewKelasView();
  if (reviewMode === 'mhs') return loadReviewMhsView();
  loadReviewTable();
});
document.getElementById('review-bulk-accept-btn').addEventListener('click', async () => {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  await apiFetch(`/admin/review/sessions/${sessionId}/questions/${questionId}/bulk-accept-auto`, { method: 'POST' });
  loadReviewTable();
});

document.getElementById('review-session-select').addEventListener('change', () => {
  updateExportLink();
  if (reviewMode === 'kelas') populateKelasOptions();
  if (reviewMode === 'mhs') populateMhsRoster();
});

document.getElementById('review-mhs-select').addEventListener('change', (e) => {
  mhsIndex = e.target.selectedIndex;
  loadReviewMhsView();
});

const kelasSearchInput = document.getElementById('review-kelas-search');
kelasSearchInput.addEventListener('input', () => {
  clearTimeout(kelasSearchTimer);
  const val = kelasSearchInput.value;
  kelasSearchTimer = setTimeout(() => runKelasSearch(val), 250);
});

function updateExportLink() {
  const sessionId = document.getElementById('review-session-select').value;
  const link = document.getElementById('export-csv-link');
  link.href = `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;
}

// ---------- Per Sesi (existing per-question board) ----------
async function loadReviewTable() {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  if (!sessionId || !questionId) return;
  updateExportLink();

  const { question, submissions } = await apiFetch(
    `/admin/review/sessions/${sessionId}/questions/${questionId}`
  );

  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const table = document.getElementById('review-table');
  table.innerHTML = `
    <p class="mb-3 flex flex-wrap items-center gap-2">
      ${levelBadge(question.level)}
      <strong class="max-w-[72ch]">${escapeHtml(question.story_text)}</strong>
      <span class="text-[color:var(--text-faint)] text-sm">(${t('admin.pointsAndType', { point: question.point, type: question.check_type })})</span>
    </p>
    <div class="overflow-x-auto"><table class="data-table">
      <thead>
        <tr>
          <th>${t('common.nim')}</th><th>${t('admin.auto')}</th><th>${t('admin.commandLog')}</th><th>${t('admin.score')}</th>
        </tr>
      </thead>
      <tbody>
        ${submissions
          .map((s) => {
            const currentFraction = s.final_score !== null && s.final_score !== undefined
              ? s.final_score / question.point
              : s.auto_score / question.point;
            const logLines = s.command_log
              .map((c) => `[${c.exit_code}] ${c.raw_command}`)
              .join('\n') || t('admin.noMatchingCmd');
            return `
              <tr>
                <td class="pr-2 font-mono">${s.nim}<br><small class="text-[color:var(--text-faint)]">${escapeHtml(s.name || '')}${s.kelas ? ' · ' + escapeHtml(s.kelas) : ''}</small></td>
                <td class="pr-2">${s.auto_result === 'pass' ? '✅' : s.auto_result === 'fail' ? '❌' : '—'}</td>
                <td class="pr-2 font-mono text-xs text-[color:var(--text-muted)] max-w-xs">
                  <pre class="whitespace-pre-wrap">${escapeHtml(logLines)}</pre>
                  <button class="show-full-log text-[color:var(--accent-hover)] text-xs hover:underline mt-1" data-participant="${s.participant_id}">${t('admin.viewAllCmds')}</button>
                </td>
                <td class="whitespace-nowrap">
                  ${fractions
                    .map(
                      (f) => `<button class="score-btn btn btn-sm ${Math.abs(currentFraction - f) < 0.01 ? 'btn-primary' : 'btn-ghost'} m-0.5"
                        data-participant="${s.participant_id}" data-fraction="${f}">${f * 100}%</button>`
                    )
                    .join('')}
                </td>
              </tr>`;
          })
          .join('')}
      </tbody>
    </table></div>`;

  table.querySelectorAll('.score-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const participantId = btn.dataset.participant;
      const fraction = parseFloat(btn.dataset.fraction);
      await apiFetch(`/admin/review/submissions/${participantId}/${questionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fraction }),
      });
      loadReviewTable();
    });
  });

  wireFullLogButtons(table);
}

// ---------- Per Kelas (one continuous read, grouped by variant) ----------
// Scan-first: auto-passed rows are folded away (and not even built into the DOM)
// until asked; only fail / unmatched / no-attempt rows render up front, with a
// per-card summary so the instructor sees "who needs review" without scrolling.

function countNeeds(subs) {
  const total = subs.length;
  const need = subs.filter((s) => s.auto_result !== 'pass').length;
  return { total, need, ok: total - need };
}

function autoPill(r) {
  if (r === 'pass') return window.ui.pill(t('admin.reviewAutoPass'), 'green');
  if (r === 'fail') return window.ui.pill(t('admin.reviewAutoFail'), 'red');
  if (r === 'unmatched') return window.ui.pill(t('admin.reviewAutoUnmatched'), 'amber');
  return window.ui.pill(t('admin.reviewAutoNone'), 'gray');
}

function renderStudentRow(s, q, rowClass) {
  const eff = (s.final_score ?? s.auto_score) ?? 0;
  const scoreCls = s.final_score != null ? ' rk-final-override' : '';
  return `<tr class="rk-row ${rowClass}" data-pid="${s.participant_id}">
    <td class="rk-nim">${escapeHtml(s.nim)}</td>
    <td>${escapeHtml(s.name || '')}</td>
    <td>${autoPill(s.auto_result)}</td>
    <td class="rk-score${scoreCls}">${eff} / ${q.point}</td>
    <td><button class="rk-log btn btn-sm btn-ghost" data-participant="${s.participant_id}" data-question="${q.id}">${t('admin.viewCmd')}</button></td>
  </tr>`;
}

function renderQuestionCard(q, variantIndex) {
  const pat = patterns(q.accepted_patterns);
  const { ok, total, need } = countNeeds(q.submissions);
  const needRows = q.submissions
    .filter((s) => s.auto_result !== 'pass')
    .map((s) => renderStudentRow(s, q, 'rk-needs'))
    .join('');
  const needMarkup = need === 0 ? '0' : `<span class="rk-summary__need">${need}</span>`;
  const summaryHtml = t('admin.reviewSummary', { ok, total, need: needMarkup });
  const stub = `<tr class="rk-pass-stub" data-qid="${q.id}"><td colspan="5">${escapeHtml(t('admin.reviewPassHidden', { n: ok }))}</td></tr>`;
  return `
    <div class="card mb-3 rk-qcard" data-qid="${q.id}" data-variant="${variantIndex}">
      <div class="flex flex-wrap items-center gap-2 mb-1">
        <span class="badge badge-plain" style="font-weight:700">#${q.order_index}</span>
        <strong class="max-w-[72ch]">${escapeHtml(q.story_text)}</strong>
        <span class="text-[color:var(--text-faint)] text-sm">${t('common.points', { n: q.point })}</span>
      </div>
      ${q.story_text_en ? `<p class="text-sm text-[color:var(--text-muted)] mb-1 max-w-[72ch]">${escapeHtml(q.story_text_en)}</p>` : ''}
      <p class="text-xs text-[color:var(--text-faint)] mb-2">${escapeHtml(checkLabel(q.check_type))}${pat ? ': ' : ''}<span class="font-mono">${escapeHtml(pat)}</span></p>
      <div class="${need === 0 ? 'rk-summary rk-summary--clear' : 'rk-summary'}">${summaryHtml}</div>
      <div class="rk-card-controls">
        <button class="rk-bulk-accept btn btn-sm btn-ghost" data-qid="${q.id}">${t('admin.bulkAccept')}</button>
        ${ok > 0 ? `<button class="rk-show-all btn btn-sm btn-ghost" data-qid="${q.id}" aria-pressed="false">${t('admin.reviewShowAll')}</button>` : ''}
      </div>
      <div class="overflow-x-auto"><table class="data-table rk-table">
        <thead><tr>
          <th>${t('common.nim')}</th><th>${t('common.name')}</th><th>${t('admin.auto')}</th><th>${t('admin.score')}</th><th>${t('admin.commandLog')}</th>
        </tr></thead>
        <tbody>${needRows}${ok > 0 ? stub : ''}</tbody>
      </table></div>
    </div>`;
}

function renderVariantGroup(g, wrap) {
  const cards = g.questions.map((q) => renderQuestionCard(q, g.variant_index)).join('');
  if (!wrap) return cards;
  const need = g.questions.reduce((n, q) => n + countNeeds(q.submissions).need, 0);
  return `<details class="rk-variant" open data-variant="${g.variant_index}">
    <summary>${escapeHtml(t('admin.reviewVariantNeed', { n: g.variant_index, need }))}</summary>
    ${cards}
  </details>`;
}

/** Build the folded auto-pass rows for one card on demand (idempotent). */
function renderPassRows(qid) {
  const card = document.querySelector(`.rk-qcard[data-qid="${cssEsc(qid)}"]`);
  if (!card || card.classList.contains('rk-pass-built')) return card;
  const q = (kelasGroups || []).flatMap((g) => g.questions).find((x) => String(x.id) === String(qid));
  const stub = card.querySelector('.rk-pass-stub');
  if (q && stub) {
    const html = q.submissions
      .filter((s) => s.auto_result === 'pass')
      .map((s) => renderStudentRow(s, q, 'rk-pass'))
      .join('');
    if (html) stub.insertAdjacentHTML('beforebegin', html);
  }
  card.classList.add('rk-pass-built');
  return card;
}

function setCardPassOpen(qid, open) {
  const card = open ? renderPassRows(qid) : document.querySelector(`.rk-qcard[data-qid="${cssEsc(qid)}"]`);
  if (!card) return;
  card.classList.toggle('rk-pass-open', open);
  const btn = card.querySelector('.rk-show-all');
  if (btn) {
    btn.setAttribute('aria-pressed', String(open));
    btn.textContent = t(open ? 'admin.reviewHideAuto' : 'admin.reviewShowAll');
  }
}

function resetKelasUiState() {
  kelasSearchQuery = '';
  expandedCards.clear();
  collapsedVariants.clear();
  searchForcedCards.clear();
  const inp = document.getElementById('review-kelas-search');
  if (inp) inp.value = '';
  const empty = document.getElementById('review-kelas-search-empty');
  if (empty) empty.classList.add('hidden');
}

/** Re-apply persisted expand / collapse / search state after a full re-render. */
function applyKelasUiState() {
  document.querySelectorAll('#review-table .rk-variant').forEach((d) => {
    d.open = !collapsedVariants.has(d.dataset.variant);
  });
  expandedCards.forEach((qid) => {
    if (document.querySelector(`.rk-qcard[data-qid="${cssEsc(qid)}"]`)) setCardPassOpen(qid, true);
  });
  if (kelasSearchQuery) {
    const inp = document.getElementById('review-kelas-search');
    if (inp) inp.value = kelasSearchQuery;
    runKelasSearch(kelasSearchQuery);
  }
}

/** Cross-card NIM/name filter: dim non-matches, highlight + scroll to the first hit. */
function runKelasSearch(raw) {
  const table = document.getElementById('review-table');
  const empty = document.getElementById('review-kelas-search-empty');
  const q = String(raw || '').trim().toLowerCase();
  kelasSearchQuery = q;

  table.querySelectorAll('.rk-row.rk-match').forEach((tr) => tr.classList.remove('rk-match'));

  if (!q) {
    table.classList.remove('rk-searching');
    if (empty) empty.classList.add('hidden');
    searchForcedCards.forEach((qid) => {
      if (!expandedCards.has(qid)) setCardPassOpen(qid, false);
    });
    searchForcedCards.clear();
    return;
  }

  table.classList.add('rk-searching');
  let first = null;
  (kelasGroups || []).forEach((g) => {
    g.questions.forEach((qq) => {
      qq.submissions.forEach((s) => {
        if (!(String(s.nim).toLowerCase().includes(q) || String(s.name || '').toLowerCase().includes(q))) return;
        const card = document.querySelector(`.rk-qcard[data-qid="${cssEsc(qq.id)}"]`);
        if (!card) return;
        const det = card.closest('details.rk-variant');
        if (det && !det.open) det.open = true;
        if (s.auto_result === 'pass' && !card.classList.contains('rk-pass-open')) {
          searchForcedCards.add(String(qq.id));
          setCardPassOpen(qq.id, true);
        }
        const tr = card.querySelector(`tr[data-pid="${cssEsc(s.participant_id)}"]`);
        if (tr) {
          tr.classList.add('rk-match');
          if (!first) first = tr;
        }
      });
    });
  });

  if (empty) empty.classList.toggle('hidden', !!first);
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function onKelasBulkAccept(qid) {
  const sessionId = document.getElementById('review-session-select').value;
  if (!(await window.ui.confirm(t('admin.reviewCardAcceptConfirm'), { icon: 'warning' }))) return;
  const res = await apiFetch(`/admin/review/sessions/${sessionId}/questions/${qid}/bulk-accept-auto`, { method: 'POST' });
  window.ui.toast(t('admin.reviewCardAcceptDone', { n: res.updatedCount }));
  loadReviewKelasView();
}

/** This question's command log for one participant, matched line flagged. Reads
 *  the in-memory kelasGroups payload — no network call. */
function showKelasLog(participant, question) {
  const g = (kelasGroups || []).flatMap((x) => x.questions).find((qq) => String(qq.id) === String(question));
  const s = g && g.submissions.find((x) => String(x.participant_id) === String(participant));
  const log = (s && s.command_log) || [];
  const lines = log.length
    ? log.map((c) => `${c.id === (s && s.matched_command_log_id) ? '» ' : '  '}[${c.exit_code}] ${c.raw_command}`).join('\n')
    : t('admin.noMatchingCmd');
  window.ui.alertPre(`${s ? s.nim : ''} — #${g ? g.order_index : ''}`, lines);
}

/** One delegated listener on the stable #review-table node — survives every
 *  re-render, no per-row re-binding. Attached once. */
function bindKelasDelegation() {
  if (kelasDelegBound) return;
  kelasDelegBound = true;
  const table = document.getElementById('review-table');

  table.addEventListener('click', (e) => {
    const stub = e.target.closest('.rk-pass-stub');
    if (stub) {
      expandedCards.add(stub.dataset.qid);
      setCardPassOpen(stub.dataset.qid, true);
      return;
    }
    const showAll = e.target.closest('.rk-show-all');
    if (showAll) {
      const qid = showAll.dataset.qid;
      const open = showAll.getAttribute('aria-pressed') !== 'true';
      if (open) {
        expandedCards.add(qid);
      } else {
        expandedCards.delete(qid);
        searchForcedCards.delete(qid);
      }
      setCardPassOpen(qid, open);
      return;
    }
    const accept = e.target.closest('.rk-bulk-accept');
    if (accept) return void onKelasBulkAccept(accept.dataset.qid);
    const log = e.target.closest('.rk-log');
    if (log) showKelasLog(log.dataset.participant, log.dataset.question);
  });

  // <details> toggle doesn't bubble — listen on the capture phase.
  table.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (!d.classList || !d.classList.contains('rk-variant')) return;
      if (d.open) collapsedVariants.delete(d.dataset.variant);
      else collapsedVariants.add(d.dataset.variant);
    },
    true
  );
}

async function loadReviewKelasView() {
  const sessionId = document.getElementById('review-session-select').value;
  const kelas = document.getElementById('review-kelas-select').value;
  if (!sessionId || !kelas) return;
  updateExportLink();

  const key = sessionId + '/' + kelas;
  if (key !== lastKelasKey) {
    resetKelasUiState();
    lastKelasKey = key;
  }

  const table = document.getElementById('review-table');
  table.innerHTML = `<div class="row-list">${Array.from({ length: 3 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  const { groups } = await apiFetch(`/admin/review/sessions/${sessionId}/kelas/${kelas}`);
  kelasGroups = groups;

  const totalQuestions = groups.reduce((n, g) => n + g.questions.length, 0);
  if (totalQuestions === 0) {
    table.innerHTML = `<div class="empty-state"><div class="empty-state__title">${escapeHtml(t('admin.reviewKelasEmpty'))}</div></div>`;
    return;
  }

  const showVariantHeaders = groups.length > 1;
  table.innerHTML = groups.map((g) => renderVariantGroup(g, showVariantHeaders)).join('');

  bindKelasDelegation();
  applyKelasUiState();
}

function wireFullLogButtons(root) {
  // Per Sesi: whole-exam log for this participant. (Per Kelas '.rk-log' is
  // handled by the delegated listener in bindKelasDelegation / showKelasLog.)
  root.querySelectorAll('.show-full-log').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fullLog = await apiFetch(`/admin/review/participants/${btn.dataset.participant}/command-log`);
      const lines =
        fullLog.map((c) => `[${c.exit_code}] ${c.raw_command}`).join('\n') || t('admin.noCmdsAtAll');
      window.ui.alertPre(t('admin.allCmdsTitle'), lines);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Per Mahasiswa (one student, every question they worked on) ----------

/** Roster for the ◀/▶ walk + the dropdown. Reuses /grades (same rows the
 *  "Mahasiswa & Nilai" tab shows) and its exact kelas→NIM sort. */
async function populateMhsRoster() {
  const sessionId = document.getElementById('review-session-select').value;
  const sel = document.getElementById('review-mhs-select');
  mhsRoster = [];
  mhsIndex = -1;
  if (!sessionId) {
    sel.innerHTML = '';
    return;
  }
  const { rows } = await apiFetch(`/admin/review/sessions/${sessionId}/grades`);
  const kelasOrder = (k) => (k == null || k === '' ? 999 : k.charCodeAt(0));
  mhsRoster = rows
    .slice()
    .sort((a, b) => kelasOrder(a.kelas) - kelasOrder(b.kelas) || String(a.nim).localeCompare(String(b.nim)));
  sel.innerHTML = mhsRoster
    .map((r, i) => {
      const kelas = r.kelas ? ` · ${t('common.kelas')} ${r.kelas}` : '';
      const undone = r.totalQuestions === 0 ? ` · ${t('admin.reviewMhsNotDone')}` : '';
      return `<option value="${i}">${escapeHtml(r.nim)} — ${escapeHtml(r.name || '')}${kelas}${undone}</option>`;
    })
    .join('');
  mhsIndex = mhsRoster.length ? 0 : -1;
}

const mhsNavBtn = (dir, label, disabled) =>
  `<button data-mhs-nav="${dir}" class="btn btn-sm btn-ghost${disabled ? ' opacity-50 cursor-not-allowed' : ''}"${
    disabled ? ' disabled' : ''
  }>${label}</button>`;

function mhsNavBar() {
  const r = mhsRoster[mhsIndex] || {};
  const kelas = r.kelas ? ` · ${t('common.kelas')} ${escapeHtml(r.kelas)}` : '';
  return `<div class="flex flex-wrap items-center gap-2 my-3">
    ${mhsNavBtn('prev', t('admin.reviewMhsPrev'), mhsIndex <= 0)}
    ${mhsNavBtn('next', t('admin.reviewMhsNext'), mhsIndex >= mhsRoster.length - 1)}
    <span class="text-sm text-[color:var(--text-faint)]">${t('admin.reviewMhsPosition', {
      n: mhsIndex + 1,
      total: mhsRoster.length,
    })}</span>
    <strong class="font-mono">${escapeHtml(r.nim || '')}</strong>
    <span class="text-sm text-[color:var(--text-muted)]">${escapeHtml(r.name || '')}${kelas}</span>
  </div>`;
}

/** One question card for the single student in view: text, check type +
 *  patterns (same format as Per Kelas), auto badge, this question's command
 *  log, and the 0/25/50/75/100% override row (same as Per Sesi). */
function renderMhsQuestionCard(s, idx) {
  const pat = patterns(s.accepted_patterns);
  const point = s.point;
  const eff = (s.final_score ?? s.auto_score) ?? 0;
  const currentFraction = point ? eff / point : 0;
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const logLines =
    (s.command_log || [])
      .map((c) => `${c.id === s.matched_command_log_id ? '» ' : '  '}[${c.exit_code}] ${c.raw_command}`)
      .join('\n') || t('admin.noMatchingCmd');
  return `
    <div class="card mb-3 mhs-qcard" data-idx="${idx}">
      <div class="flex flex-wrap items-center gap-2 mb-1">
        <span class="badge badge-plain" style="font-weight:700">#${s.order_index}</span>
        <strong class="max-w-[72ch]">${escapeHtml(s.story_text)}</strong>
        <span class="text-[color:var(--text-faint)] text-sm">${t('common.points', { n: point })}</span>
        ${autoPill(s.auto_result)}
      </div>
      ${
        s.story_text_en
          ? `<p class="text-sm text-[color:var(--text-muted)] mb-1 max-w-[72ch]">${escapeHtml(s.story_text_en)}</p>`
          : ''
      }
      <p class="text-xs text-[color:var(--text-faint)] mb-2">${escapeHtml(checkLabel(s.check_type))}${
        pat ? ': ' : ''
      }<span class="font-mono">${escapeHtml(pat)}</span></p>
      <pre class="font-mono text-xs text-[color:var(--text-muted)] whitespace-pre-wrap mb-1">${escapeHtml(logLines)}</pre>
      <button class="show-full-log text-[color:var(--accent-hover)] text-xs hover:underline mb-2"
        data-participant="${mhsData.participant.id}">${t('admin.viewAllCmds')}</button>
      <div class="whitespace-nowrap${s.final_score != null ? ' rk-final-override' : ''}">
        <span class="text-sm text-[color:var(--text-faint)] mr-1">${t('admin.score')}: ${eff} / ${point}</span>
        ${fractions
          .map(
            (f) => `<button class="mhs-score-btn btn btn-sm ${
              Math.abs(currentFraction - f) < 0.01 ? 'btn-primary' : 'btn-ghost'
            } m-0.5" data-idx="${idx}" data-fraction="${f}">${f * 100}%</button>`
          )
          .join('')}
      </div>
    </div>`;
}

/** Delegated once on the stable #review-table node: ◀/▶ walk, score override
 *  (patches just the one card, no reload), and the full-exam log popup. */
function bindMhsDelegation() {
  if (mhsDelegBound) return;
  mhsDelegBound = true;
  const table = document.getElementById('review-table');

  table.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-mhs-nav]');
    if (nav) {
      if (nav.disabled) return;
      mhsIndex += nav.dataset.mhsNav === 'next' ? 1 : -1;
      loadReviewMhsView();
      return;
    }
    const full = e.target.closest('.mhs-qcard .show-full-log');
    if (full) {
      const logs = await apiFetch(`/admin/review/participants/${full.dataset.participant}/command-log`);
      const lines = logs.map((c) => `[${c.exit_code}] ${c.raw_command}`).join('\n') || t('admin.noCmdsAtAll');
      window.ui.alertPre(t('admin.allCmdsTitle'), lines);
      return;
    }
    const score = e.target.closest('.mhs-score-btn');
    if (score) {
      const idx = Number(score.dataset.idx);
      const s = mhsData && mhsData.submissions[idx];
      if (!s) return;
      const updated = await apiFetch(`/admin/review/submissions/${mhsData.participant.id}/${s.question_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fraction: parseFloat(score.dataset.fraction) }),
      });
      s.final_score = updated.final_score;
      const card = table.querySelector(`.mhs-qcard[data-idx="${idx}"]`);
      if (card) card.outerHTML = renderMhsQuestionCard(s, idx);
    }
  });
}

async function loadReviewMhsView() {
  const sessionId = document.getElementById('review-session-select').value;
  if (!sessionId) return;
  const table = document.getElementById('review-table');
  bindMhsDelegation();

  if (!mhsRoster.length) await populateMhsRoster();
  if (!mhsRoster.length) {
    table.innerHTML = `<div class="empty-state"><div class="empty-state__title">${escapeHtml(
      t('admin.reviewKelasEmpty')
    )}</div></div>`;
    return;
  }
  mhsIndex = Math.max(0, Math.min(mhsIndex, mhsRoster.length - 1));
  updateExportLink();

  const sel = document.getElementById('review-mhs-select');
  if (sel.selectedIndex !== mhsIndex) sel.selectedIndex = mhsIndex;

  const p = mhsRoster[mhsIndex];
  table.innerHTML = `<div class="row-list">${Array.from({ length: 3 }, () => '<div class="skeleton skeleton-row"></div>').join(
    ''
  )}</div>`;
  mhsData = await apiFetch(`/admin/review/participants/${p.participant_id}`);

  const nav = mhsNavBar();
  const body = mhsData.submissions.length
    ? mhsData.submissions.map((s, i) => renderMhsQuestionCard(s, i)).join('')
    : `<div class="empty-state"><div class="empty-state__title">${escapeHtml(
        t('admin.reviewMhsNoSubmissions')
      )}</div></div>`;
  table.innerHTML = nav + body + nav;
}

window.addEventListener('i18n:changed', () => {
  if (!document.getElementById('review-table').innerHTML) return;
  if (reviewMode === 'kelas') loadReviewKelasView();
  else if (reviewMode === 'mhs') loadReviewMhsView();
  else loadReviewTable();
});

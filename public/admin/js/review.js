// Review Nilai — "Per Mahasiswa": one student, every question they worked on.
// The picker is two-level: a kelas dropdown narrows the roster, a debounced
// search box filters it further, and ◀/▶ walk the filtered result set.

// Roster (from /grades, sorted like the "Mahasiswa & Nilai" tab) + the derived
// filtered view + a cursor into it.
let mhsRosterAll = []; // full roster for the selected session
let mhsFiltered = []; // mhsRosterAll after kelas + search filter
let mhsPos = -1; // cursor into mhsFiltered
let mhsKelas = ''; // '' = all classes
let mhsQuery = ''; // lowercased NIM/name search
let mhsSearchTimer = null;
let mhsData = null; // last /participants/:id payload { participant, submissions, total }
let mhsDelegBound = false;

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
  await populateMhsRoster();
}
window.loadReviewSessionOptions = loadReviewSessionOptions;

/** Roster for the ◀/▶ walk + the dropdowns. Reuses /grades (same rows the
 *  "Mahasiswa & Nilai" tab shows) and its exact kelas→NIM sort. */
async function populateMhsRoster() {
  const sessionId = document.getElementById('review-session-select').value;
  mhsRosterAll = [];
  mhsKelas = '';
  mhsQuery = '';
  document.getElementById('review-mhs-search').value = '';
  if (!sessionId) {
    document.getElementById('review-mhs-kelas-select').innerHTML = '';
    document.getElementById('review-mhs-select').innerHTML = '';
    return;
  }
  const { rows } = await apiFetch(`/admin/review/sessions/${sessionId}/grades`);
  const kelasOrder = (k) => (k == null || k === '' ? 999 : k.charCodeAt(0));
  mhsRosterAll = rows
    .slice()
    .sort((a, b) => kelasOrder(a.kelas) - kelasOrder(b.kelas) || String(a.nim).localeCompare(String(b.nim)));
  populateKelasDropdown();
  applyMhsFilter();
}

/** Kelas dropdown: "Semua Kelas" + one option per distinct kelas in the roster. */
function populateKelasDropdown() {
  const sel = document.getElementById('review-mhs-kelas-select');
  const classes = [...new Set(mhsRosterAll.map((r) => r.kelas).filter(Boolean))].sort();
  sel.innerHTML =
    `<option value="">${t('admin.reviewAllKelas')}</option>` +
    classes.map((k) => `<option value="${escapeHtml(k)}">${t('common.kelas')} ${escapeHtml(k)}</option>`).join('');
  sel.value = mhsKelas;
  mhsKelas = sel.value; // snap back to '' if the previously-picked kelas is gone
}

function mhsOptionLabel(r) {
  const kelas = r.kelas ? ` · ${t('common.kelas')} ${r.kelas}` : '';
  const undone = r.totalQuestions === 0 ? ` · ${t('admin.reviewMhsNotDone')}` : '';
  return `${escapeHtml(r.nim)} — ${escapeHtml(r.name || '')}${kelas}${undone}`;
}

/** Rebuild #review-mhs-select from mhsFiltered (option value = index into it). */
function renderMhsSelect() {
  const sel = document.getElementById('review-mhs-select');
  sel.innerHTML = mhsFiltered.map((r, i) => `<option value="${i}">${mhsOptionLabel(r)}</option>`).join('');
  if (mhsPos >= 0 && mhsPos < mhsFiltered.length) sel.selectedIndex = mhsPos;
}

/** Recompute the filtered roster from kelas + search, reset the cursor. */
function applyMhsFilter() {
  mhsFiltered = mhsRosterAll.filter(
    (r) =>
      (!mhsKelas || r.kelas === mhsKelas) &&
      (!mhsQuery ||
        String(r.nim).toLowerCase().includes(mhsQuery) ||
        String(r.name || '').toLowerCase().includes(mhsQuery))
  );
  mhsPos = mhsFiltered.length ? 0 : -1;
  renderMhsSelect();
  document.getElementById('review-mhs-search-empty').classList.toggle(
    'hidden',
    !(mhsRosterAll.length && !mhsFiltered.length)
  );
  document.getElementById('review-table').innerHTML = '';
}

document.getElementById('review-load-btn').addEventListener('click', () => loadReviewMhsView());

document.getElementById('review-session-select').addEventListener('change', () => {
  updateExportLink();
  populateMhsRoster();
});

document.getElementById('review-mhs-kelas-select').addEventListener('change', (e) => {
  mhsKelas = e.target.value;
  applyMhsFilter();
});

// Trailing 250 ms debounce — same shape as the old Per Kelas search box.
const mhsSearchInput = document.getElementById('review-mhs-search');
mhsSearchInput.addEventListener('input', () => {
  clearTimeout(mhsSearchTimer);
  const val = mhsSearchInput.value;
  mhsSearchTimer = setTimeout(() => {
    mhsQuery = val.trim().toLowerCase();
    applyMhsFilter();
  }, 250);
});

document.getElementById('review-mhs-select').addEventListener('change', (e) => {
  mhsPos = e.target.selectedIndex;
  loadReviewMhsView();
});

function updateExportLink() {
  const sessionId = document.getElementById('review-session-select').value;
  const link = document.getElementById('export-csv-link');
  link.href = `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;
}

function autoPill(r) {
  if (r === 'pass') return window.ui.pill(t('admin.reviewAutoPass'), 'green');
  if (r === 'fail') return window.ui.pill(t('admin.reviewAutoFail'), 'red');
  if (r === 'unmatched') return window.ui.pill(t('admin.reviewAutoUnmatched'), 'amber');
  return window.ui.pill(t('admin.reviewAutoNone'), 'gray');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Per Mahasiswa render ----------

const mhsNavBtn = (dir, label, disabled) =>
  `<button data-mhs-nav="${dir}" class="btn btn-sm btn-ghost${disabled ? ' opacity-50 cursor-not-allowed' : ''}"${
    disabled ? ' disabled' : ''
  }>${label}</button>`;

function mhsNavBar() {
  const r = mhsFiltered[mhsPos] || {};
  const kelas = r.kelas ? ` · ${t('common.kelas')} ${escapeHtml(r.kelas)}` : '';
  return `<div class="flex flex-wrap items-center gap-2 my-3">
    ${mhsNavBtn('prev', t('admin.reviewMhsPrev'), mhsPos <= 0)}
    ${mhsNavBtn('next', t('admin.reviewMhsNext'), mhsPos >= mhsFiltered.length - 1)}
    <span class="text-sm text-[color:var(--text-faint)]">${t('admin.reviewMhsPosition', {
      n: mhsPos + 1,
      total: mhsFiltered.length,
    })}</span>
    <strong class="font-mono">${escapeHtml(r.nim || '')}</strong>
    <span class="text-sm text-[color:var(--text-muted)]">${escapeHtml(r.name || '')}${kelas}</span>
  </div>`;
}

/** One question card for the single student in view: text, check type +
 *  patterns, auto badge, this question's command log, and the
 *  0/25/50/75/100% override row. */
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
      mhsPos += nav.dataset.mhsNav === 'next' ? 1 : -1;
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

  if (!mhsRosterAll.length) await populateMhsRoster();
  if (!mhsFiltered.length) {
    table.innerHTML = `<div class="empty-state"><div class="empty-state__title">${escapeHtml(
      t(mhsRosterAll.length ? 'admin.reviewSearchNoHit' : 'admin.reviewKelasEmpty')
    )}</div></div>`;
    return;
  }
  mhsPos = Math.max(0, Math.min(mhsPos, mhsFiltered.length - 1));
  updateExportLink();

  const sel = document.getElementById('review-mhs-select');
  if (sel.selectedIndex !== mhsPos) sel.selectedIndex = mhsPos;

  const p = mhsFiltered[mhsPos];
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
  if (!mhsRosterAll.length) return;
  const hadTable = !!document.getElementById('review-table').innerHTML;
  populateKelasDropdown();
  renderMhsSelect();
  if (hadTable) loadReviewMhsView();
});

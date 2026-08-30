const GRADES_PAGE_SIZE = 25;
let gradesRows = [];
let gradesPage = 1;

async function loadGradesSessionOptions() {
  const sessions = await apiFetch('/admin/sessions');
  const sel = document.getElementById('grades-session-select');
  const prevValue = sel.value;
  sel.innerHTML = sessions
    .map((s) => `<option value="${s.id}">${s.name} — UCP ${s.ucp ?? 1}</option>`)
    .join('');
  if (prevValue && sessions.some((s) => String(s.id) === prevValue)) sel.value = prevValue;
  if (sel.value) loadGradesTable();
}
window.loadGradesSessionOptions = loadGradesSessionOptions;

document.getElementById('grades-load-btn').addEventListener('click', loadGradesTable);
document.getElementById('grades-session-select').addEventListener('change', loadGradesTable);

const GRADES_CONTAINER_TONE = {
  active: 'green',
  running: 'green',
  ready: 'blue',
  ending: 'amber',
  provisioning: 'amber',
  not_started: 'gray',
  ended: 'gray',
  destroyed: 'gray',
  error: 'red',
};
const gSkeleton = (n = 3) =>
  `<div class="row-list">${Array.from({ length: n }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;

const escHtml = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

// kelas A→F, nulls last, then NIM within each group
const kelasOrder = (k) => (k == null || k === '' ? 999 : k.charCodeAt(0));

async function loadGradesTable() {
  const sessionId = document.getElementById('grades-session-select').value;
  if (!sessionId) return;

  document.getElementById('grades-export-csv-link').href =
    `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;

  const table = document.getElementById('grades-table');
  table.innerHTML = gSkeleton(3);
  const { rows } = await apiFetch(`/admin/review/sessions/${sessionId}/grades`);

  gradesRows = rows.slice().sort(
    (a, b) => kelasOrder(a.kelas) - kelasOrder(b.kelas) || String(a.nim).localeCompare(String(b.nim))
  );
  gradesPage = 1;

  if (gradesRows.length === 0) {
    table.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <div class="empty-state__title">${escHtml(t('admin.noParticipantsYet'))}</div>
    </div>`;
    return;
  }
  renderGradesTable();
}

function renderGradesTable() {
  const table = document.getElementById('grades-table');
  const sessionId = document.getElementById('grades-session-select').value;
  const pageCount = Math.max(1, Math.ceil(gradesRows.length / GRADES_PAGE_SIZE));
  const slice = gradesRows.slice((gradesPage - 1) * GRADES_PAGE_SIZE, gradesPage * GRADES_PAGE_SIZE);

  const statusLabel = (s) => {
    const k = 'admin.status.' + s;
    return t(k) === k ? s : t(k);
  };
  const kelasHeader = (k) => (k == null || k === '' ? t('admin.kelasNone') : `${t('common.kelas')} ${k}`);

  let html = '';
  let lastKelas = Symbol('none');
  for (const r of slice) {
    if (r.kelas !== lastKelas) {
      if (html) html += '</div>';
      lastKelas = r.kelas;
      html += `<div class="section-label mt-4 mb-2">${escHtml(kelasHeader(r.kelas))}</div><div class="row-list">`;
    }
    const meta = [
      `<span class="mono">${escHtml(r.nim)}</span>`,
      `<span>${t('common.variant')} ${r.variant_index}</span>`,
    ].join('');
    html += `<div class="card-row">
      ${window.ui.avatarHtml(r.name || r.nim)}
      <div class="card-row__identity">
        <div class="card-row__name">${escHtml(r.name || '-')}</div>
        <div class="card-row__meta">${meta}</div>
      </div>
      <div class="card-row__aside">
        ${window.ui.pill(statusLabel(r.container_status), GRADES_CONTAINER_TONE[r.container_status] || 'gray')}
        <span class="badge badge-blue badge-plain">${t('admin.solved')} ${r.solvedCount}/${r.totalQuestions}</span>
        <span class="badge badge-gray badge-plain">${t('admin.reviewed')} ${r.reviewedCount}/${r.totalQuestions}</span>
        <span class="badge badge-plain" style="font-weight:700">${r.total} / ${r.maxTotal}</span>
        <button class="grades-transcript-row btn btn-sm btn-ghost" data-nim="${escHtml(r.nim)}"
          aria-label="${t('admin.transcriptForNim', { nim: r.nim })}" title="${t('admin.transcriptForNim', { nim: r.nim })}">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>
        </button>
      </div>
    </div>`;
  }
  if (html) html += '</div>';
  table.innerHTML = html;

  const pager = window.ui.pager({
    page: gradesPage,
    pageCount,
    onChange: (p) => {
      gradesPage = p;
      renderGradesTable();
      table.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  });
  if (pager) table.appendChild(pager);

  table.querySelectorAll('.grades-transcript-row').forEach((btn) =>
    btn.addEventListener('click', () => openTranscriptModal(sessionId, btn.dataset.nim))
  );
}

// ---- session transcript: every command, every participant, time-ordered (modal) ----
let transcriptEntries = null;
let transcriptFilter = '';

document.getElementById('grades-transcript-btn').addEventListener('click', () => {
  const sessionId = document.getElementById('grades-session-select').value;
  if (!sessionId) return window.ui.alert(t('admin.noParticipantsYet'), { icon: 'info' });
  openTranscriptModal(sessionId, '');
});

async function openTranscriptModal(sessionId, nimFilter = '') {
  const { entries } = await apiFetch(`/admin/review/sessions/${sessionId}/transcript`);
  transcriptEntries = entries;
  transcriptFilter = nimFilter || '';
  window.Swal.fire({
    title: transcriptFilter ? t('admin.transcriptForNim', { nim: transcriptFilter }) : t('admin.sessionTranscript'),
    html: renderTranscript(),
    width: 'min(920px, 96vw)',
    showConfirmButton: false,
    showCloseButton: true,
    customClass: { popup: 'ui-swal-popup' },
  });
}

function renderTranscript() {
  const wrap = document.createElement('div');
  const entries = transcriptEntries || [];

  if (entries.length === 0) {
    wrap.innerHTML = `<p class="text-sm text-[color:var(--text-faint)]">${t('admin.noCommandsSession')}</p>`;
    return wrap;
  }

  const nims = [...new Set(entries.map((e) => e.nim))].sort();
  const shown = transcriptFilter ? entries.filter((e) => e.nim === transcriptFilter) : entries;
  const time = (iso) => new Date(iso).toLocaleTimeString();

  wrap.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <span class="badge badge-gray">${shown.length}</span>
      <select id="transcript-filter" class="field w-auto min-w-[180px] ml-auto">
        <option value="">${t('admin.allParticipants')} (${entries.length})</option>
        ${nims
          .map((n) => `<option value="${escHtml(n)}"${n === transcriptFilter ? ' selected' : ''}>${escHtml(n)}</option>`)
          .join('')}
      </select>
    </div>
    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>${t('admin.time')}</th>
            <th>${t('common.nim')}</th>
            <th>${t('common.kelas')}</th>
            <th>${t('admin.command')}</th>
            <th>${t('admin.exit')}</th>
            <th>${t('admin.question')}</th>
          </tr>
        </thead>
        <tbody>
          ${shown
            .map((e) => {
              const q = e.is_match
                ? `<span class="badge badge-green">✓ ${t('common.questionN', { n: e.question_order })}</span>`
                : e.question_order != null
                ? `<span class="badge badge-gray">${t('common.questionN', { n: e.question_order })}</span>`
                : '<span class="text-[color:var(--text-faint)]">—</span>';
              const exit =
                e.exit_code === 0
                  ? '<span class="text-[color:var(--success)]">0</span>'
                  : `<span class="text-[color:var(--danger)]">${e.exit_code == null ? '?' : escHtml(e.exit_code)}</span>`;
              return `<tr>
                <td class="whitespace-nowrap text-[color:var(--text-faint)]">${time(e.created_at)}</td>
                <td class="font-mono whitespace-nowrap">${escHtml(e.nim)}</td>
                <td class="whitespace-nowrap text-[color:var(--text-muted)]">${escHtml(e.kelas || '—')}</td>
                <td class="font-mono text-xs">${escHtml(e.raw_command)}</td>
                <td>${exit}</td>
                <td class="whitespace-nowrap">${q}</td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>`;

  wrap.querySelector('#transcript-filter').addEventListener('change', (ev) => {
    transcriptFilter = ev.target.value;
    const fresh = renderTranscript();
    wrap.replaceWith(fresh);
  });
  return wrap;
}

window.openTranscriptModal = openTranscriptModal; // reused by the session participant list

window.addEventListener('i18n:changed', () => {
  const sessionId = document.getElementById('grades-session-select').value;
  if (sessionId && document.getElementById('grades-table').innerHTML) loadGradesTable();
});

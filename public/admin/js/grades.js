async function loadGradesSessionOptions() {
  const sessions = await apiFetch('/admin/sessions');
  const sel = document.getElementById('grades-session-select');
  const prevValue = sel.value;
  sel.innerHTML = sessions.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
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

async function loadGradesTable() {
  const sessionId = document.getElementById('grades-session-select').value;
  if (!sessionId) return;

  document.getElementById('grades-export-csv-link').href =
    `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;

  const table = document.getElementById('grades-table');
  table.innerHTML = gSkeleton(3);
  const { rows } = await apiFetch(`/admin/review/sessions/${sessionId}/grades`);

  if (rows.length === 0) {
    table.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <div class="empty-state__title">${escHtml(t('admin.noParticipantsYet'))}</div>
    </div>`;
    return;
  }

  const statusLabel = (s) => {
    const k = 'admin.status.' + s;
    return t(k) === k ? s : t(k);
  };

  table.innerHTML = `<div class="row-list">${rows
    .map((r) => {
      const meta = [
        `<span class="mono">${escHtml(r.nim)}</span>`,
        `<span>${t('common.variant')} ${r.variant_index}</span>`,
        r.kelas ? `<span>${escHtml(r.kelas)}</span>` : '',
      ]
        .filter(Boolean)
        .join('');
      return `<div class="card-row">
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
        </div>
      </div>`;
    })
    .join('')}</div>`;
}

// ---- session transcript: every command, every participant, time-ordered ----
let transcriptEntries = null;
let transcriptFilter = '';

const escHtml = (s) => {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
};

document.getElementById('grades-session-select').addEventListener('change', hideTranscript);

document.getElementById('grades-transcript-btn').addEventListener('click', async () => {
  const panel = document.getElementById('grades-transcript');
  const sessionId = document.getElementById('grades-session-select').value;
  if (!sessionId) return;
  if (!panel.classList.contains('hidden')) return hideTranscript(); // toggle off

  const { entries } = await apiFetch(`/admin/review/sessions/${sessionId}/transcript`);
  transcriptEntries = entries;
  transcriptFilter = '';
  panel.classList.remove('hidden');
  renderTranscript();
});

function hideTranscript() {
  const panel = document.getElementById('grades-transcript');
  panel.classList.add('hidden');
  panel.innerHTML = '';
  transcriptEntries = null;
}

function renderTranscript() {
  const panel = document.getElementById('grades-transcript');
  const entries = transcriptEntries || [];

  if (entries.length === 0) {
    panel.innerHTML = `<p class="text-sm text-[color:var(--text-faint)]">${t('admin.noCommandsSession')}</p>`;
    return;
  }

  const nims = [...new Set(entries.map((e) => e.nim))].sort();
  const shown = transcriptFilter ? entries.filter((e) => e.nim === transcriptFilter) : entries;
  const time = (iso) => new Date(iso).toLocaleTimeString();

  panel.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <span class="font-semibold text-sm">${t('admin.sessionTranscript')}</span>
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

  document.getElementById('transcript-filter').addEventListener('change', (ev) => {
    transcriptFilter = ev.target.value;
    renderTranscript();
  });
}

window.addEventListener('i18n:changed', () => {
  const sessionId = document.getElementById('grades-session-select').value;
  if (sessionId && document.getElementById('grades-table').innerHTML) loadGradesTable();
  if (transcriptEntries) renderTranscript();
});

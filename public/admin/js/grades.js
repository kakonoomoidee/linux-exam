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

const containerBadge = {
  active: 'badge-green',
  ending: 'badge-amber',
  ended: 'badge-gray',
  destroyed: 'badge-gray',
  error: 'badge-gray',
  not_started: 'badge-gray',
  provisioning: 'badge-amber',
};

async function loadGradesTable() {
  const sessionId = document.getElementById('grades-session-select').value;
  if (!sessionId) return;

  document.getElementById('grades-export-csv-link').href =
    `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;

  const { rows } = await apiFetch(`/admin/review/sessions/${sessionId}/grades`);
  const table = document.getElementById('grades-table');

  if (rows.length === 0) {
    table.innerHTML = `<p class="text-sm text-[color:var(--text-faint)]">${t('admin.noParticipantsYet')}</p>`;
    return;
  }

  table.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t('common.nim')}</th>
          <th>${t('common.name')}</th>
          <th>${t('common.variant')}</th>
          <th>${t('admin.containerStatus')}</th>
          <th>${t('admin.solved')}</th>
          <th>${t('admin.reviewed')}</th>
          <th>${t('admin.totalScore')}</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td class="font-mono">${r.nim}</td>
              <td>${r.name || '-'}</td>
              <td>${r.variant_index}</td>
              <td><span class="badge ${containerBadge[r.container_status] || 'badge-gray'}">${t('admin.status.' + r.container_status) !== 'admin.status.' + r.container_status ? t('admin.status.' + r.container_status) : r.container_status}</span></td>
              <td>${r.solvedCount}/${r.totalQuestions}</td>
              <td>${r.reviewedCount}/${r.totalQuestions}</td>
              <td class="font-semibold">${r.total} / ${r.maxTotal}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
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

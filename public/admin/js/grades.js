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

window.addEventListener('i18n:changed', () => {
  const sessionId = document.getElementById('grades-session-select').value;
  if (sessionId && document.getElementById('grades-table').innerHTML) loadGradesTable();
});

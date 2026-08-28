let currentSessionId = null;

document.getElementById('create-session-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-session-name').value.trim();
  const duration_minutes = parseInt(document.getElementById('new-session-duration').value, 10) || 10;
  if (!name) return alert(t('admin.sessionNameRequired'));
  await apiFetch('/admin/sessions', { method: 'POST', body: JSON.stringify({ name, duration_minutes }) });
  document.getElementById('new-session-name').value = '';
  loadSessions();
});

document.getElementById('add-participants-btn').addEventListener('click', async () => {
  const raw = document.getElementById('participant-nims').value;
  const nims = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // "NIM" or "NIM, Nama" (comma / semicolon / tab separated)
      const [nim, ...rest] = line.split(/[,;\t]/);
      const name = rest.join(',').trim();
      return name ? { nim: nim.trim(), name } : nim.trim();
    });
  if (nims.length === 0) return;
  await apiFetch(`/admin/sessions/${currentSessionId}/participants`, {
    method: 'POST',
    body: JSON.stringify({ nims }),
  });
  document.getElementById('participant-nims').value = '';
  loadParticipants(currentSessionId);
});

document.getElementById('start-session-btn').addEventListener('click', async () => {
  if (!confirm(t('admin.startConfirm'))) return;
  await apiFetch(`/admin/sessions/${currentSessionId}/start`, { method: 'POST' });
  alert(t('admin.provisioningStarted'));
  setTimeout(() => loadParticipants(currentSessionId), 3000);
});

async function loadSessions() {
  const sessions = await apiFetch('/admin/sessions');
  const list = document.getElementById('session-list');
  const statusBadge = { pending: 'badge-gray', running: 'badge-green', ended: 'badge-gray' };
  list.innerHTML = sessions
    .map(
      (s) => `
      <div class="session-row flex items-center gap-3 py-2.5 px-2 rounded-[var(--radius-sm)] hover:bg-[color:var(--surface-2)]" data-id="${s.id}">
        <span class="session-open flex-1 min-w-0 truncate cursor-pointer">${s.name} <small class="text-[color:var(--text-faint)]">(${t('common.minutes', { n: s.duration_minutes })})</small></span>
        <span class="badge ${statusBadge[s.status] || ''}">${t('admin.status.' + s.status)}</span>
        <button class="session-delete btn btn-ghost btn-sm" data-id="${s.id}"
          title="${t('admin.deleteSession')}" aria-label="${t('admin.deleteSession')}">✕</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('.session-open').forEach((el) => {
    el.addEventListener('click', () => openSession(el.closest('.session-row').dataset.id, sessions));
  });
  list.querySelectorAll('.session-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('admin.deleteConfirm'))) return;
      await apiFetch(`/admin/sessions/${btn.dataset.id}`, { method: 'DELETE' });
      if (String(currentSessionId) === btn.dataset.id) {
        currentSessionId = null;
        document.getElementById('session-detail-panel').classList.add('hidden');
      }
      loadSessions();
    });
  });
}

function openSession(id, sessions) {
  currentSessionId = id;
  const session = sessions.find((s) => String(s.id) === String(id));
  document.getElementById('session-detail-panel').classList.remove('hidden');
  document.getElementById('session-detail-title').textContent = session.name;
  loadParticipants(id);
}

async function loadParticipants(sessionId) {
  const participants = await apiFetch(`/admin/sessions/${sessionId}/participants`);
  const list = document.getElementById('participant-list');
  list.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t('common.nim')}</th><th>${t('common.name')}</th><th>${t('common.variant')}</th><th>${t('admin.containerStatus')}</th>
        </tr>
      </thead>
      <tbody>
        ${participants
          .map(
            (p) => `<tr>
              <td class="font-mono">${p.nim}</td><td>${p.name || '-'}</td><td>${p.variant_index}</td>
              <td><span class="badge ${p.container_status === 'running' ? 'badge-green' : 'badge-gray'}">${p.container_status}</span></td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

window.loadSessions = loadSessions;

window.addEventListener('i18n:changed', () => {
  if (!document.getElementById('dashboard-screen').classList.contains('hidden')) {
    loadSessions();
    if (currentSessionId) loadParticipants(currentSessionId);
  }
});

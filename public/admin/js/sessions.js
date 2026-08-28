let currentSessionId = null;
let sessionCountdownInterval = null;

document.getElementById('create-session-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-session-name').value.trim();
  const duration_minutes = parseInt(document.getElementById('new-session-duration').value, 10) || 10;
  if (!name) return window.ui.alert(t('admin.sessionNameRequired'), { icon: 'warning' });
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
  const ok = await window.ui.confirm(t('admin.startConfirm'), { icon: 'warning', confirmText: t('admin.startSession') });
  if (!ok) return;
  await apiFetch(`/admin/sessions/${currentSessionId}/start`, { method: 'POST' });
  window.ui.toast(t('admin.provisioningStarted'), 'info');
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
        ${s.status === 'running' && s.started_at
          ? `<span class="session-countdown text-xs font-mono font-semibold text-[color:var(--text-muted)]"
               data-ends-at="${new Date(new Date(s.started_at).getTime() + s.duration_minutes * 60000).toISOString()}">--:--</span>`
          : ''}
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
      const ok = await window.ui.confirm(t('admin.deleteConfirm'), { icon: 'warning', confirmText: t('admin.deleteSession') });
      if (!ok) return;
      await apiFetch(`/admin/sessions/${btn.dataset.id}`, { method: 'DELETE' });
      if (String(currentSessionId) === btn.dataset.id) {
        currentSessionId = null;
        document.getElementById('session-detail-panel').classList.add('hidden');
      }
      loadSessions();
    });
  });

  startSessionCountdowns();
}

/**
 * Ticks every "session-countdown" badge in the list once a second — this is
 * a nominal display (session-level started_at + duration), separate from
 * each participant's own precise per-container timer shown on their exam
 * page. Good enough for "berapa menit lagi sesi ini" at a glance.
 */
function startSessionCountdowns() {
  clearInterval(sessionCountdownInterval);
  const tick = () => {
    document.querySelectorAll('.session-countdown').forEach((el) => {
      const endsAt = new Date(el.dataset.endsAt).getTime();
      const remainingSec = Math.floor((endsAt - Date.now()) / 1000);
      if (remainingSec <= 0) {
        el.textContent = t('admin.timeUp');
        el.classList.remove('text-[color:var(--text-muted)]');
        el.classList.add('text-[color:var(--text-faint)]');
        return;
      }
      const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
      const sec = String(remainingSec % 60).padStart(2, '0');
      el.textContent = `${m}:${sec}`;
      el.classList.toggle('text-[color:var(--danger)]', remainingSec <= 60);
    });
  };
  tick();
  sessionCountdownInterval = setInterval(tick, 1000);
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
          <th>${t('common.nim')}</th><th>${t('common.name')}</th><th>${t('common.variant')}</th>
          <th>${t('admin.containerStatus')}</th><th>${t('admin.lockStatus')}</th>
        </tr>
      </thead>
      <tbody>
        ${participants.map(renderParticipantRow).join('')}
      </tbody>
    </table>`;

  list.querySelectorAll('.force-unlock-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/admin/review/participants/${btn.dataset.id}/force-unlock`, { method: 'POST' });
      loadParticipants(sessionId);
    });
  });
}

function renderParticipantRow(p) {
  const locked = Boolean(p.locked_at);
  const lockCell = locked
    ? `<span class="badge badge-amber">🔒 ${t('admin.locked')}</span>
       <span class="font-mono text-lg font-bold tracking-[0.2em] mx-2">${p.lock_code || '------'}</span>
       <span class="text-xs text-[color:var(--text-faint)]">${t('admin.violationsN', { n: p.violation_count || 0 })}</span>
       <button class="force-unlock-btn btn btn-ghost btn-sm ml-2" data-id="${p.id}">${t('admin.forceUnlock')}</button>`
    : p.violation_count
    ? `<span class="text-xs text-[color:var(--text-faint)]">${t('admin.violationsN', { n: p.violation_count })}</span>`
    : '<span class="text-[color:var(--text-faint)]">—</span>';
  return `<tr>
    <td class="font-mono">${p.nim}</td><td>${p.name || '-'}</td><td>${p.variant_index}</td>
    <td><span class="badge ${p.container_status === 'running' ? 'badge-green' : 'badge-gray'}">${p.container_status}</span></td>
    <td class="whitespace-nowrap">${lockCell}</td>
  </tr>`;
}

window.loadSessions = loadSessions;
window.loadParticipants = loadParticipants;
window.getOpenSessionId = () => currentSessionId;

window.addEventListener('i18n:changed', () => {
  if (!document.getElementById('dashboard-screen').classList.contains('hidden')) {
    loadSessions();
    if (currentSessionId) loadParticipants(currentSessionId);
  }
});

let currentSessionId = null;
let sessionCountdownInterval = null;

const esc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
const skeletonRows = (n = 3) =>
  Array.from({ length: n }, () => '<div class="skeleton skeleton-row"></div>').join('');
function emptyState(title, hint) {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
    <div class="empty-state__title">${esc(title)}</div>
    ${hint ? `<div class="empty-state__hint">${esc(hint)}</div>` : ''}
  </div>`;
}

const CONTAINER_TONE = {
  active: 'green',
  running: 'green',
  ready: 'blue',
  provisioning: 'amber',
  not_started: 'gray',
  ending: 'amber',
  ended: 'gray',
  destroyed: 'gray',
  error: 'red',
};
const containerPill = (status) =>
  window.ui.pill(t('admin.status.' + status) || status, CONTAINER_TONE[status] || 'gray');

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
      // "NIM" | "NIM, Nama" | "NIM, Nama, Kelas" (comma / semicolon / tab separated)
      const [nim, name, ...kelasParts] = line.split(/[,;\t]/).map((x) => x.trim());
      const kelas = kelasParts.join(',').trim();
      if (!name && !kelas) return nim;
      return { nim, name: name || undefined, kelas: kelas || undefined };
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
  window.ui.toast(t('admin.sessionStarted'), 'success');
  loadSessions();
  loadParticipants(currentSessionId); // reveals the join code
});

async function loadSessions() {
  const list = document.getElementById('session-list');
  list.innerHTML = `<div class="row-list">${skeletonRows(3)}</div>`;
  const sessions = await apiFetch('/admin/sessions');
  const statusTone = { pending: 'gray', running: 'green', ended: 'gray' };

  if (sessions.length === 0) {
    list.innerHTML = emptyState(t('admin.noSessionsTitle'), t('admin.noSessionsHint'));
  } else {
    list.innerHTML = `<div class="row-list">${sessions
      .map((s) => {
        const countdown =
          s.status === 'running' && s.started_at
            ? `<span class="session-countdown badge badge-blue"
                 data-ends-at="${new Date(new Date(s.started_at).getTime() + s.duration_minutes * 60000).toISOString()}">--:--</span>`
            : '';
        return `
        <div class="card-row session-row" data-id="${s.id}">
          ${window.ui.avatarHtml(s.name)}
          <div class="card-row__identity session-open cursor-pointer">
            <div class="card-row__name">${esc(s.name)}</div>
            <div class="card-row__meta"><span>${t('common.minutes', { n: s.duration_minutes })}</span></div>
          </div>
          <div class="card-row__aside">
            ${countdown}
            ${window.ui.pill(t('admin.status.' + s.status), statusTone[s.status] || 'gray')}
            <details class="kebab">
              <summary aria-label="${t('common.actions')}">⋮</summary>
              <div class="kebab-menu">
                <button class="kebab-item session-open-menu" data-id="${s.id}">${t('admin.openSession')}</button>
                <button class="kebab-item danger session-delete" data-id="${s.id}">${t('admin.deleteSession')}</button>
              </div>
            </details>
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  list.querySelectorAll('.session-open, .session-open-menu').forEach((el) => {
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
 * Ticks every "session-countdown" badge in the list once a second — a nominal
 * display (session started_at + duration), separate from each participant's
 * precise per-container timer on their exam page.
 */
function startSessionCountdowns() {
  clearInterval(sessionCountdownInterval);
  const tick = () => {
    document.querySelectorAll('.session-countdown').forEach((el) => {
      const endsAt = new Date(el.dataset.endsAt).getTime();
      const remainingSec = Math.floor((endsAt - Date.now()) / 1000);
      if (remainingSec <= 0) {
        el.textContent = t('admin.timeUp');
        return;
      }
      const m = String(Math.floor(remainingSec / 60)).padStart(2, '0');
      const sec = String(remainingSec % 60).padStart(2, '0');
      el.textContent = `${m}:${sec}`;
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
  const list = document.getElementById('participant-list');
  list.innerHTML = `<div class="row-list">${skeletonRows(3)}</div>`;
  const session = await apiFetch(`/admin/sessions/${sessionId}`);
  const participants = session.participants || [];

  renderJoinCode(session);

  if (participants.length === 0) {
    list.innerHTML = emptyState(t('admin.noParticipantsYet'), t('admin.noParticipantsHint'));
    return;
  }

  list.innerHTML = `<div class="row-list">${participants.map(renderParticipantRow).join('')}</div>`;

  list.querySelectorAll('.force-unlock-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiFetch(`/admin/review/participants/${btn.dataset.id}/force-unlock`, { method: 'POST' });
      loadParticipants(sessionId);
    });
  });
}

function renderJoinCode(session) {
  const box = document.getElementById('join-code-box');
  if (session.status === 'running' && session.join_code) {
    document.getElementById('join-code-value').textContent = session.join_code;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function renderParticipantRow(p) {
  const locked = Boolean(p.locked_at);
  const lockBadge = locked
    ? window.ui.pill(`🔒 ${t('admin.locked')} · ${p.lock_code || '------'}`, 'amber')
    : p.violation_count
    ? window.ui.pill(t('admin.violationsN', { n: p.violation_count }), 'gray')
    : '';
  const kebab = locked
    ? `<details class="kebab">
         <summary aria-label="${t('common.actions')}">⋮</summary>
         <div class="kebab-menu">
           <button class="kebab-item force-unlock-btn" data-id="${p.id}">${t('admin.forceUnlock')}</button>
         </div>
       </details>`
    : '';
  const meta = [
    `<span class="mono">${esc(p.nim)}</span>`,
    `<span>${t('common.variant')} ${p.variant_index}</span>`,
    p.kelas ? `<span>${esc(p.kelas)}</span>` : '',
  ]
    .filter(Boolean)
    .join('');
  return `<div class="card-row">
    ${window.ui.avatarHtml(p.name || p.nim)}
    <div class="card-row__identity">
      <div class="card-row__name">${esc(p.name || '-')}</div>
      <div class="card-row__meta">${meta}</div>
    </div>
    <div class="card-row__aside">
      ${lockBadge}
      ${containerPill(p.container_status)}
      ${kebab}
    </div>
  </div>`;
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

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

// "Buat Sesi Baru" is a plain <a href="/admin/sessions/new"> — no JS needed.
// The "Sesi" tab is now a plain index — creating a session, managing its roster,
// showing the join code and starting the exam all live on the standalone
// /admin/sessions/:id page.
async function loadSessions() {
  const list = document.getElementById('session-list');
  list.innerHTML = `<div class="row-list">${skeletonRows(3)}</div>`;
  const sessions = await apiFetch('/admin/sessions');
  const statusTone = { pending: 'gray', running: 'green', ended: 'gray' };
  const isInstruktur = window.adminRole === 'instruktur'; // asisten: no delete

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
            ${window.ui.pill(t('admin.ucpN', { n: s.ucp ?? 1 }), 'gray')}
            ${window.ui.pill(t('admin.status.' + s.status), statusTone[s.status] || 'gray')}
            <details class="kebab">
              <summary aria-label="${t('common.actions')}">⋮</summary>
              <div class="kebab-menu">
                <button class="kebab-item session-open-menu" data-id="${s.id}">${t('admin.openSession')}</button>
                ${isInstruktur ? `<button class="kebab-item danger session-delete" data-id="${s.id}">${t('admin.deleteSession')}</button>` : ''}
              </div>
            </details>
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  list.querySelectorAll('.session-open, .session-open-menu').forEach((el) => {
    el.addEventListener('click', () => {
      location.href = '/admin/sessions/' + el.closest('.session-row').dataset.id;
    });
  });
  list.querySelectorAll('.session-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await window.ui.confirm(t('admin.deleteConfirm'), { icon: 'warning', confirmText: t('admin.deleteSession') });
      if (!ok) return;
      await apiFetch(`/admin/sessions/${btn.dataset.id}`, { method: 'DELETE' });
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

window.loadSessions = loadSessions;

window.addEventListener('i18n:changed', () => {
  if (!document.getElementById('dashboard-screen').classList.contains('hidden')) loadSessions();
});

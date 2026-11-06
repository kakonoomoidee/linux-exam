// Review Nilai v2 — shared state + helpers for the three levels:
//   1. sessions (review-sessions.js)  2. students of a session (review-students.js)
//   3. one student, side by side with the key (review-detail.js)
// Data: /api/admin/grading/*. API, t, adminToken, apiFetch come from api.js.
(function () {
  const LABEL_TONE = { correct: 'green', correct_in_history: 'blue', near_miss: 'amber', wrong: 'red' };
  const STATUS_TONE = { done: 'green', partial: 'blue', pending: 'gray' };
  const LEVELS = ['sessions', 'students', 'detail'];

  const state = {
    level: 'sessions',
    sessionId: null,
    session: null,
    overview: null, // last /grading/sessions/:id payload
    visibleStudents: [], // level-2 list after filter + sort: drives prev/next on level 3
    studentPos: -1,
    overviewStale: false, // a correction was saved: refetch level 2 on the way back
  };

  const esc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
  const lang = () => window.i18n.getLang();
  const fmtNum = (n) => (n == null ? '—' : String(Math.round(Number(n) * 100) / 100));

  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(lang() === 'en' ? 'en-GB' : 'id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleTimeString(lang() === 'en' ? 'en-GB' : 'id-ID') : '';
  }

  const labelPill = (label) => window.ui.pill(t(`review.label.${label}`), LABEL_TONE[label] || 'gray');
  const statusPill = (status) => window.ui.pill(t(`review.status.${status}`), STATUS_TONE[status] || 'gray');
  const reasonText = (code) => t(`review.reason.${code}`);
  const storyOf = (q) => (lang() === 'en' && (q.story_text_en || q.storyTextEn)) || q.story_text || q.storyText || '';

  function exportHref(sessionId, kind) {
    const tok = encodeURIComponent(adminToken);
    const base = `${API}/admin/grading/sessions/${sessionId}`;
    if (kind === 'xlsx') return `${base}/export.xlsx?token=${tok}`;
    return `${base}/export.csv?${kind === 'detail' ? 'detail=1&' : ''}token=${tok}`;
  }

  /** Export menu (kebab of plain download links — they carry the token in the query, like the old CSV link). */
  function exportMenu(sessionId, { asButton = false } = {}) {
    const items = [
      ['csv', 'review.exportCsv'],
      ['xlsx', 'review.exportXlsx'],
      ['detail', 'review.exportDetailCsv'],
    ]
      .map(([kind, key]) => `<a class="kebab-item" href="${exportHref(sessionId, kind)}" download>${esc(t(key))}</a>`)
      .join('');
    const summary = asButton
      ? `<summary class="btn btn-ghost btn-sm rv-export-btn">${esc(t('review.export'))}</summary>`
      : `<summary aria-label="${esc(t('review.export'))}" title="${esc(t('review.export'))}">⋮</summary>`;
    return `<details class="kebab${asButton ? ' rv-export' : ''}">${summary}<div class="kebab-menu">${items}</div></details>`;
  }

  const skeleton = (n = 3) =>
    `<div class="row-list">${Array.from({ length: n }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  const emptyState = (key) => `<div class="empty-state"><div class="empty-state__title">${esc(t(key))}</div></div>`;
  const errorBox = (msg) => `<div class="empty-state"><div class="empty-state__title rv-error">${esc(msg)}</div></div>`;

  function renderCrumbs() {
    const nav = document.getElementById('rv-crumbs');
    const parts = [`<button type="button" class="rv-crumb" data-rv-go="sessions">${esc(t('review.crumbSessions'))}</button>`];
    if (state.level !== 'sessions' && state.session) {
      parts.push(`<button type="button" class="rv-crumb" data-rv-go="students">${esc(state.session.name)}</button>`);
    }
    if (state.level === 'detail') {
      const s = state.visibleStudents[state.studentPos];
      parts.push(`<span class="rv-crumb is-current" aria-current="page">${esc(s ? s.name || s.nim : '')}</span>`);
    }
    nav.innerHTML = parts.join('<span class="rv-crumb-sep" aria-hidden="true">/</span>');
  }

  function show(level) {
    state.level = level;
    for (const l of LEVELS) document.getElementById(`rv-level-${l}`).hidden = l !== level;
    renderCrumbs();
  }

  document.getElementById('rv-crumbs').addEventListener('click', (e) => {
    const go = e.target.closest('[data-rv-go]');
    if (!go) return;
    if (go.dataset.rvGo === 'sessions') window.rv.openSessions();
    if (go.dataset.rvGo === 'students') window.rv.openSession(state.sessionId);
  });

  const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const reviewTabVisible = () => !document.getElementById('tab-review').classList.contains('hidden');

  // Level-3 shortcuts; review-detail.js registers the handler.
  document.addEventListener('keydown', (e) => {
    if (!reviewTabVisible() || state.level !== 'detail' || isTyping(e.target)) return;
    // a modal (not a toast) owns the keyboard
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.swal2-popup:not(.swal2-toast)')) return;
    window.rv.onDetailKey?.(e);
  });

  window.addEventListener('i18n:changed', () => {
    if (!reviewTabVisible()) return;
    renderCrumbs();
    window.rv.rerender?.[state.level]?.();
  });

  window.rv = {
    state, esc, fmtNum, fmtDateTime, fmtTime, labelPill, statusPill, reasonText, storyOf,
    exportMenu, skeleton, emptyState, errorBox, show, renderCrumbs, rerender: {},
  };
  // app.js calls this when the "Review Nilai" tab opens.
  window.loadReviewSessionOptions = () => window.rv.openSessions();
})();

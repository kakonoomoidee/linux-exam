// Review Nilai v2 — level 1: every session with participants, average grade,
// unreviewed "hampir benar" count, and export.
(function () {
  const { esc } = window.rv;
  let sessions = null;

  function sessionRow(s) {
    const rv = window.rv;
    const when = s.started_at || s.created_at;
    const nearMiss = s.nearMissPending
      ? `<span class="badge badge-amber">${esc(t('review.nearMissPending', { n: s.nearMissPending }))}</span>`
      : `<span class="badge badge-gray badge-plain">${esc(t('review.nearMissNone'))}</span>`;
    return `<div class="card-row rv-row">
      ${window.ui.avatarHtml(s.name.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || s.name)}
      <div class="card-row__identity">
        <button type="button" class="card-row__name rv-link" data-rv-session="${s.id}">${esc(s.name)}</button>
        <div class="card-row__meta">
          <span>${esc(rv.fmtDateTime(when))}</span>
          <span>UCP ${esc(s.ucp)}</span>
          <span>${esc(t(`admin.status.${s.status}`))}</span>
        </div>
      </div>
      <div class="card-row__aside rv-aside">
        <span class="badge badge-blue badge-plain">${esc(t('review.participantsN', { n: s.participantCount }))}</span>
        <span class="badge badge-plain rv-strong">${esc(t('review.averageN', { n: rv.fmtNum(s.averageGrade) }))}</span>
        ${nearMiss}
        <button type="button" class="btn btn-sm btn-primary" data-rv-session="${s.id}">${esc(t('review.open'))}</button>
        ${rv.exportMenu(s.id)}
      </div>
    </div>`;
  }

  function render() {
    const box = document.getElementById('rv-level-sessions');
    if (!sessions) return;
    box.innerHTML = sessions.length
      ? `<div class="card"><div class="row-list">${sessions.map(sessionRow).join('')}</div></div>`
      : `<div class="card">${window.rv.emptyState('review.noSessions')}</div>`;
  }

  async function openSessions() {
    const rv = window.rv;
    rv.show('sessions');
    const box = document.getElementById('rv-level-sessions');
    box.innerHTML = `<div class="card">${rv.skeleton(4)}</div>`;
    try {
      ({ sessions } = await apiFetch('/admin/grading/sessions'));
      render();
    } catch (err) {
      box.innerHTML = `<div class="card">${rv.errorBox(err.message)}</div>`;
    }
  }

  document.getElementById('rv-level-sessions').addEventListener('click', (e) => {
    const open = e.target.closest('[data-rv-session]');
    if (open) window.rv.openSession(Number(open.dataset.rvSession));
  });

  window.rv.openSessions = openSessions;
  window.rv.rerender.sessions = render;
})();

// Review Nilai v2 — level 2: students of one session (filter kelas, search
// NIM/name, sort) + the session summary (review-summary.js).
(function () {
  const { esc, state } = window.rv;
  const filter = { kelas: '', query: '', sort: 'nim' };
  const SEARCH_DEBOUNCE_MS = 250;
  let searchTimer = null;

  const SORTERS = {
    nim: (a, b) => String(a.nim).localeCompare(String(b.nim)),
    name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
    finalDesc: (a, b) => b.finalGrade - a.finalGrade || SORTERS.nim(a, b),
    finalAsc: (a, b) => a.finalGrade - b.finalGrade || SORTERS.nim(a, b),
    nearMiss: (a, b) => b.nearMissPending - a.nearMissPending || SORTERS.nim(a, b),
    status: (a, b) => ['pending', 'partial', 'done'].indexOf(a.status) - ['pending', 'partial', 'done'].indexOf(b.status) || SORTERS.nim(a, b),
  };

  function applyFilter() {
    const q = filter.query;
    state.visibleStudents = state.overview.students
      .filter((s) => !filter.kelas || s.kelas === filter.kelas)
      .filter((s) => !q || String(s.nim).toLowerCase().includes(q) || String(s.name || '').toLowerCase().includes(q))
      .sort(SORTERS[filter.sort] || SORTERS.nim);
  }

  function studentRow(s, i) {
    const rv = window.rv;
    const nearMiss = s.nearMissPending
      ? `<span class="badge badge-amber">${esc(t('review.nearMissN', { n: s.nearMissPending }))}</span>`
      : '';
    return `<div class="card-row rv-row">
      ${window.ui.avatarHtml(s.name || s.nim)}
      <div class="card-row__identity">
        <button type="button" class="card-row__name rv-link" data-rv-student="${i}">${esc(s.name || '—')}</button>
        <div class="card-row__meta">
          <span class="mono">${esc(s.nim)}</span>
          <span>${esc(t('common.kelas'))} ${esc(s.kelas || '—')}</span>
          <span>${esc(t('common.variant'))} ${esc(s.variantIndex)}</span>
        </div>
      </div>
      <div class="card-row__aside rv-aside">
        <span class="rv-score" title="${esc(t('review.autoVsFinal'))}">
          <span class="rv-score__auto">${esc(rv.fmtNum(s.autoTotal))}</span>
          <span aria-hidden="true">→</span>
          <strong>${esc(rv.fmtNum(s.finalTotal))}</strong><span class="meta-faint">/${esc(rv.fmtNum(s.maxTotal))}</span>
        </span>
        ${nearMiss}
        ${rv.statusPill(s.status)}
        <button type="button" class="btn btn-sm btn-ghost" data-rv-student="${i}">${esc(t('review.reviewBtn'))}</button>
      </div>
    </div>`;
  }

  function toolbar() {
    const classes = [...new Set(state.overview.students.map((s) => s.kelas).filter(Boolean))].sort();
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    const sorts = ['nim', 'name', 'finalDesc', 'finalAsc', 'nearMiss', 'status'];
    return `<div class="rv-toolbar">
      <label class="sr-only" for="rv-kelas">${esc(t('common.kelas'))}</label>
      <select id="rv-kelas" class="field w-auto min-w-[150px]">
        ${opt('', t('admin.reviewAllKelas'), filter.kelas)}${classes.map((k) => opt(k, `${t('common.kelas')} ${k}`, filter.kelas)).join('')}
      </select>
      <label class="sr-only" for="rv-search">${esc(t('admin.reviewSearchPlaceholder'))}</label>
      <input id="rv-search" type="search" autocomplete="off" class="field w-auto min-w-[200px]"
        placeholder="${esc(t('admin.reviewSearchPlaceholder'))}" value="${esc(filter.query)}">
      <label class="sr-only" for="rv-sort">${esc(t('review.sortBy'))}</label>
      <select id="rv-sort" class="field w-auto min-w-[190px]">
        ${sorts.map((k) => opt(k, t(`review.sort.${k}`), filter.sort)).join('')}
      </select>
      <span class="rv-toolbar__end">${window.rv.exportMenu(state.sessionId, { asButton: true })}</span>
    </div>`;
  }

  function renderList() {
    applyFilter();
    const list = document.getElementById('rv-student-list');
    list.innerHTML = state.visibleStudents.length
      ? `<div class="row-list">${state.visibleStudents.map(studentRow).join('')}</div>`
      : window.rv.emptyState(state.overview.students.length ? 'admin.reviewSearchNoHit' : 'admin.noParticipantsYet');
  }

  function render() {
    if (!state.overview) return;
    const box = document.getElementById('rv-level-students');
    box.innerHTML = `${window.rv.summaryHtml(state.overview.summary)}
      <div class="card">${toolbar()}<div id="rv-student-list"></div></div>`;
    window.ui.enhanceAllSelects(box);
    renderList();
  }

  async function openSession(sessionId) {
    const rv = window.rv;
    const isNewSession = state.sessionId !== sessionId;
    if (isNewSession) Object.assign(filter, { kelas: '', query: '', sort: 'nim' });
    state.sessionId = sessionId;
    const box = document.getElementById('rv-level-students');
    if (isNewSession || state.overviewStale || !state.overview) {
      box.innerHTML = `<div class="card">${rv.skeleton(5)}</div>`;
      rv.show('students');
      try {
        state.overview = await apiFetch(`/admin/grading/sessions/${sessionId}`);
        state.session = state.overview.session;
        state.overviewStale = false;
      } catch (err) {
        box.innerHTML = `<div class="card">${rv.errorBox(err.message)}</div>`;
        return;
      }
    }
    rv.show('students');
    render();
  }

  const box = document.getElementById('rv-level-students');
  box.addEventListener('click', (e) => {
    const open = e.target.closest('[data-rv-student]');
    if (open) window.rv.openStudent(Number(open.dataset.rvStudent));
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'rv-kelas') filter.kelas = e.target.value;
    if (e.target.id === 'rv-sort') filter.sort = e.target.value;
    if (e.target.id === 'rv-kelas' || e.target.id === 'rv-sort') renderList();
  });
  box.addEventListener('input', (e) => {
    if (e.target.id !== 'rv-search') return;
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => {
      filter.query = value.trim().toLowerCase();
      renderList();
    }, SEARCH_DEBOUNCE_MS);
  });

  window.rv.openSession = openSession;
  window.rv.rerender.students = render;
})();

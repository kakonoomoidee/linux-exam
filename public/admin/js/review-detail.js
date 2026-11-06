// Review Nilai v2 — level 3: one student, every question as a two-column row
// (review-question-row.js). Header, prev/next student, question filter,
// saving corrections, keyboard shortcuts.
(function () {
  const { esc, state } = window.rv;
  const FILTERS = ['all', 'wrong', 'nearMiss', 'reviewed'];
  let detail = null;
  let qFilter = 'all';
  let focusedQid = null;

  const box = () => document.getElementById('rv-level-detail');
  const currentStudent = () => state.visibleStudents[state.studentPos];

  function headerHtml() {
    const s = detail.student;
    const rv = window.rv;
    const last = state.visibleStudents.length - 1;
    return `<div class="card rv-head">
      <div class="rv-head__who">
        ${window.ui.avatarHtml(s.name || s.nim)}
        <div>
          <h2 class="rv-head__name">${esc(s.name || '—')}</h2>
          <div class="card-row__meta">
            <span class="mono">${esc(s.nim)}</span><span>${esc(t('common.kelas'))} ${esc(s.kelas || '—')}</span>
            <span>${esc(t('common.variant'))} ${esc(s.variantIndex)}</span>${rv.statusPill(s.status)}
          </div>
        </div>
      </div>
      <div class="rv-head__score" title="${esc(t('review.autoVsFinal'))}">
        <span class="rv-score__auto">${esc(rv.fmtNum(s.autoTotal))}</span><span aria-hidden="true">→</span>
        <strong>${esc(rv.fmtNum(s.finalTotal))}</strong><span class="meta-faint">/${esc(rv.fmtNum(s.maxTotal))}</span>
        <span class="badge badge-blue badge-plain">${esc(t('review.finalGradeN', { n: rv.fmtNum(s.finalGrade) }))}</span>
      </div>
      <div class="rv-head__nav">
        <button type="button" class="btn btn-sm btn-ghost" data-rv-nav="-1" ${state.studentPos <= 0 ? 'disabled' : ''}
          title="P">${esc(t('admin.reviewMhsPrev'))}</button>
        <span class="meta-faint">${esc(t('admin.reviewMhsPosition', { n: state.studentPos + 1, total: state.visibleStudents.length }))}</span>
        <button type="button" class="btn btn-sm btn-ghost" data-rv-nav="1" ${state.studentPos >= last ? 'disabled' : ''}
          title="N">${esc(t('admin.reviewMhsNext'))}</button>
        <button type="button" class="btn btn-sm btn-primary" data-rv-next-open title="J">${esc(t('review.nextToCorrect'))}</button>
      </div>
      <p class="rv-shortcuts">${esc(t('review.shortcutsHint'))}</p>
    </div>`;
  }

  function filterChips() {
    const counts = { all: detail.questions.length, wrong: 0, nearMiss: 0, reviewed: 0 };
    for (const item of detail.questions) {
      const c = window.rv.questionCategories(item);
      for (const k of ['wrong', 'nearMiss', 'reviewed']) if (c[k]) counts[k]++;
    }
    return `<div class="rv-chips" role="group" aria-label="${esc(t('review.filterLabel'))}">${FILTERS.map((f) =>
      `<button type="button" class="btn btn-sm ${f === qFilter ? 'btn-primary' : 'btn-ghost'}" data-rv-filter="${f}"
        aria-pressed="${f === qFilter}">${esc(t(`review.filter.${f}`))} <span class="rv-chip-n">${counts[f]}</span></button>`).join('')}</div>`;
  }

  function visibleItems() {
    if (qFilter === 'all') return detail.questions;
    return detail.questions.filter((item) => window.rv.questionCategories(item)[qFilter]);
  }

  function render() {
    if (!detail) return;
    const items = visibleItems();
    const rows = items.length
      ? items.map((item) => window.rv.questionRowHtml(item, detail.commands)).join('')
      : window.rv.emptyState('review.filterEmpty');
    box().innerHTML = `${headerHtml()}<div class="card rv-questions">${filterChips()}
      <p class="rv-attrib-note">${esc(t('review.historyAttributionNote'))}</p>${rows}</div>`;
    if (focusedQid) document.getElementById(`rv-q-${focusedQid}`)?.classList.add('is-focused');
  }

  async function load(pos, { keepScroll = false } = {}) {
    state.studentPos = pos;
    const s = currentStudent();
    if (!s) return;
    const y = window.scrollY;
    if (!keepScroll) {
      box().innerHTML = `<div class="card">${window.rv.skeleton(4)}</div>`;
      focusedQid = null;
    }
    window.rv.show('detail');
    try {
      detail = await apiFetch(`/admin/grading/participants/${s.participantId}`);
    } catch (err) {
      box().innerHTML = `<div class="card">${window.rv.errorBox(err.message)}</div>`;
      return;
    }
    Object.assign(s, detail.student); // keep the level-2 row in sync for prev/next labels
    render();
    if (keepScroll) window.scrollTo(0, y);
    else box().scrollIntoView({ block: 'start' });
  }

  function focusQuestion(qid) {
    focusedQid = qid;
    box().querySelectorAll('.rv-qrow.is-focused').forEach((el) => el.classList.remove('is-focused'));
    const row = document.getElementById(`rv-q-${qid}`);
    if (!row) return;
    row.classList.add('is-focused');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.querySelector('.rv-pct')?.focus({ preventScroll: true });
  }

  /** Next (dir=1) / previous question that still needs a correction, wrapping around. */
  function jumpToOpen(dir = 1) {
    if (qFilter !== 'all' && qFilter !== 'wrong') {
      qFilter = 'all';
      render();
    }
    const open = detail.questions.filter((item) => window.rv.questionCategories(item).needsCorrection).map((i) => i.question.id);
    if (!open.length) return window.ui.toast(t('review.allCorrected'), 'info');
    const order = detail.questions.map((i) => i.question.id);
    const cur = focusedQid ? order.indexOf(focusedQid) : -1;
    const ranked = open.map((id) => ({ id, d: (order.indexOf(id) - cur) * dir })).sort((a, b) => a.d - b.d);
    const next = ranked.find((r) => r.d > 0) || ranked[0];
    focusQuestion(next.id);
  }

  function step(dir) {
    const pos = state.studentPos + dir;
    if (pos >= 0 && pos < state.visibleStudents.length) load(pos);
  }

  function markDirty(form) {
    const selected = form.querySelector('.rv-pct[aria-pressed="true"]');
    const item = detail.questions.find((i) => String(i.question.id) === form.dataset.qid);
    const note = form.querySelector('.rv-note').value.trim();
    const pctChanged = selected && selected.dataset.pct !== form.dataset.current;
    const noteChanged = note !== (item.submission?.review_note || '');
    form.querySelector('.rv-save').disabled = !selected || !(pctChanged || noteChanged);
  }

  async function saveCorrection(form, method) {
    const qid = form.dataset.qid;
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    const path = `/admin/grading/participants/${currentStudent().participantId}/questions/${qid}/correction`;
    try {
      if (method === 'PUT') {
        const percent = Number(form.querySelector('.rv-pct[aria-pressed="true"]').dataset.pct);
        await apiFetch(path, { method, body: JSON.stringify({ percent, note: form.querySelector('.rv-note').value }) });
      } else {
        await apiFetch(path, { method });
      }
      state.overviewStale = true;
      focusedQid = Number(qid);
      window.ui.toast(t(method === 'PUT' ? 'review.saved' : 'review.cleared'));
      await load(state.studentPos, { keepScroll: true });
    } catch (err) {
      buttons.forEach((b) => { b.disabled = false; });
      window.ui.alert(err.message, { icon: 'error' });
    }
  }

  const el = box();
  el.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-rv-nav]');
    if (nav) return step(Number(nav.dataset.rvNav));
    if (e.target.closest('[data-rv-next-open]')) return jumpToOpen(1);
    const f = e.target.closest('[data-rv-filter]');
    if (f) {
      qFilter = f.dataset.rvFilter;
      return render();
    }
    const hist = e.target.closest('[data-rv-history]');
    if (hist) {
      const qid = Number(hist.dataset.rvHistory);
      const set = window.rv.expandedHistory;
      if (set.has(qid)) set.delete(qid);
      else set.add(qid);
      return render();
    }
    const editKey = e.target.closest('[data-rv-edit-key]');
    if (editKey) return window.openSampleAnswersEditor?.(Number(editKey.dataset.rvEditKey), () => load(state.studentPos, { keepScroll: true }));
    const pct = e.target.closest('.rv-pct');
    if (pct) {
      const form = pct.closest('form');
      form.querySelectorAll('.rv-pct').forEach((b) => {
        const on = b === pct;
        b.setAttribute('aria-pressed', String(on));
        b.classList.toggle('btn-primary', on);
        b.classList.toggle('btn-ghost', !on);
      });
      focusedQid = Number(form.dataset.qid);
      return markDirty(form);
    }
    const clear = e.target.closest('.rv-clear');
    if (clear) saveCorrection(clear.closest('form'), 'DELETE');
  });
  el.addEventListener('input', (e) => {
    if (e.target.classList.contains('rv-note')) markDirty(e.target.closest('form'));
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!e.target.querySelector('.rv-save').disabled) saveCorrection(e.target, 'PUT');
  });

  const KEYS = { n: () => step(1), p: () => step(-1), j: () => jumpToOpen(1), k: () => jumpToOpen(-1) };
  window.rv.onDetailKey = (e) => {
    const fn = KEYS[e.key.toLowerCase()];
    if (!fn || !detail) return;
    e.preventDefault();
    fn();
  };
  window.rv.openStudent = (pos) => load(pos);
  window.rv.rerender.detail = render;
})();

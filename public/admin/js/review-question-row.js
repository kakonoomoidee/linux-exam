// Review Nilai v2 — one question row on level 3. LEFT: the student's command
// history + auto-grade + detection + correction form. RIGHT: story, meta and
// the readable answer key. Both halves live in one grid row so they align.
(function () {
  const { esc } = window.rv;
  const PERCENTS = [0, 25, 50, 75, 100];
  const expandedHistory = new Set(); // question ids showing the full log

  const isReviewed = (sub) => sub && sub.final_score !== null && sub.final_score !== undefined;
  const isPass = (sub) => sub && sub.auto_result === 'pass';
  const needsAttention = (label) => label === 'near_miss' || label === 'correct_in_history';

  /** Filter categories used by the level-3 chips + "next to correct" shortcut. */
  function categories(item) {
    return {
      wrong: !isPass(item.submission),
      nearMiss: needsAttention(item.detection.label),
      reviewed: isReviewed(item.submission),
      needsCorrection: !isPass(item.submission) && !isReviewed(item.submission),
    };
  }

  function commandTags(c, d) {
    const tags = [];
    if (c.id === d.gradedLogId) tags.push(['graded', t('review.cmd.graded')]);
    else if (d.matchedLogIds.includes(c.id)) tags.push(['match', t('review.cmd.match')]);
    if (c.id === d.candidateLogId && d.label !== 'correct') tags.push(['candidate', t('review.cmd.candidate')]);
    return tags;
  }

  function historyHtml(item, commands) {
    const d = item.detection;
    const qid = item.question.id;
    const relevant = new Set(d.relevantLogIds);
    const showAll = expandedHistory.has(qid);
    const shown = showAll ? commands : commands.filter((c) => relevant.has(c.id));
    const lines = shown.map((c) => {
      const tags = commandTags(c, d);
      const cls = tags.map(([k]) => ` is-${k}`).join('');
      const exitCls = c.exit_code === 0 ? 'ok' : 'bad';
      return `<li class="rv-cmd${cls}">
        <time datetime="${esc(c.created_at)}">${esc(window.rv.fmtTime(c.created_at))}</time>
        <code>${esc(c.raw_command)}</code>
        <span class="rv-exit rv-exit--${exitCls}" title="exit code">${esc(c.exit_code ?? '?')}</span>
        ${tags.map(([k, label]) => `<span class="rv-tag rv-tag--${k}">${esc(label)}</span>`).join('')}
      </li>`;
    });
    const toggle = commands.length > shown.length || showAll
      ? `<button type="button" class="rv-linkbtn" data-rv-history="${qid}">${esc(
        showAll ? t('review.historyRelevantOnly') : t('review.historyShowAll', { n: commands.length }))}</button>`
      : '';
    return `<div class="rv-history">
      <div class="rv-history__head"><span class="section-label">${esc(t('review.historyTitle'))}</span>${toggle}</div>
      ${lines.length ? `<ol class="rv-history__list">${lines.join('')}</ol>` : `<p class="meta-faint">${esc(t('review.historyEmpty'))}</p>`}
    </div>`;
  }

  function detectionHtml(item) {
    const d = item.detection;
    if (d.label === 'correct') return '';
    const reasons = d.reasons.map((r) => `<li>${esc(window.rv.reasonText(r))}</li>`).join('');
    return `<div class="rv-detect rv-detect--${d.label}">
      <ul>${reasons}</ul>
      <div class="rv-suggest">${esc(t('review.suggested'))} <strong>${d.suggestedPercent}%</strong></div>
    </div>`;
  }

  function correctionHtml(item) {
    const sub = item.submission;
    const current = isReviewed(sub) ? sub.finalPercent : null;
    const suggested = item.detection.suggestedPercent;
    const buttons = PERCENTS.map((p) => `<button type="button" class="btn btn-sm ${p === current ? 'btn-primary' : 'btn-ghost'} rv-pct"
        data-pct="${p}" aria-pressed="${p === current}">${p}%${p === suggested && item.detection.label !== 'correct'
        ? `<span class="rv-pct__hint" title="${esc(t('review.suggested'))}">★</span>` : ''}</button>`).join('');
    const reviewer = isReviewed(sub)
      ? `<p class="rv-reviewer">${esc(t('review.reviewedBy', { who: sub.reviewer_name || '—', when: window.rv.fmtDateTime(sub.reviewed_at) }))}</p>`
      : '';
    return `<form class="rv-correct" data-qid="${item.question.id}" data-current="${current ?? ''}" novalidate>
      <div class="rv-pct-group" role="group" aria-label="${esc(t('review.correctionLabel'))}">${buttons}</div>
      <label class="sr-only" for="rv-note-${item.question.id}">${esc(t('review.note'))}</label>
      <textarea id="rv-note-${item.question.id}" class="field rv-note" rows="2" maxlength="1000"
        placeholder="${esc(t('review.notePlaceholder'))}">${esc(sub?.review_note || '')}</textarea>
      <div class="rv-correct__actions">
        <button type="submit" class="btn btn-sm btn-primary rv-save" disabled>${esc(t('common.save'))}</button>
        ${isReviewed(sub) ? `<button type="button" class="btn btn-sm btn-ghost rv-clear">${esc(t('review.clearCorrection'))}</button>` : ''}
      </div>
      ${reviewer}
    </form>`;
  }

  function keyHtml(item) {
    const k = item.key;
    const patterns = k.patterns.map((p) => `<li class="rv-key-item">
      <div class="rv-examples">${p.examples.length
        ? p.examples.map((ex) => `<code class="rv-example">${esc(ex)}</code>`).join('')
        : `<span class="meta-faint">${esc(t('review.noExample'))}</span>`}
        ${p.derived ? `<span class="rv-tag rv-tag--auto">${esc(t('review.exampleDerived'))}</span>` : ''}</div>
      ${p.conflictExample ? `<p class="rv-warn">${esc(t('review.suspect.normalizationHint', { example: p.conflictExample }))}</p>` : ''}
      <details class="rv-regex"><summary>${esc(t('review.showRegex'))}</summary><code>${esc(p.pattern)}</code></details>
    </li>`).join('');
    const stateExamples = !k.patterns.length && k.examples.length
      ? `<div class="rv-examples">${k.examples.map((ex) => `<code class="rv-example">${esc(ex)}</code>`).join('')}</div>` : '';
    const checks = k.stateChecks.map((c) => `<li>${esc(t(`review.state.${c.check}`, { target: c.target, value: c.value || '' }))}</li>`).join('');
    const script = item.question.state_checker_script;
    const stateBlock = script ? `<div class="rv-state">
      <div class="section-label">${esc(t('review.stateCheckTitle'))}</div>
      ${checks ? `<ul class="rv-state__list">${checks}</ul>` : ''}${stateExamples}
      <details class="rv-regex"><summary>${esc(t('review.showScript'))}</summary><code>${esc(script)}</code></details>
    </div>` : '';
    const edit = window.adminRole === 'instruktur'
      ? `<button type="button" class="rv-linkbtn" data-rv-edit-key="${item.question.id}">${esc(t('review.editExamples'))}</button>` : '';
    return `<div class="rv-key"><div class="rv-key__head"><span class="section-label">${esc(t('review.answerKey'))}</span>${edit}</div>
      ${patterns ? `<ul class="rv-key__list">${patterns}</ul>` : ''}${stateBlock}</div>`;
  }

  function rightHtml(item) {
    const q = item.question;
    const tone = { easy: 'green', medium: 'amber', hard: 'red' }[q.level] || 'amber';
    return `<div class="rv-qrow__right">
      <p class="rv-story">${esc(window.rv.storyOf(q))}</p>
      <div class="rv-meta">
        ${window.ui.pill(t(`admin.level.${q.level || 'medium'}`), tone)}
        <span class="badge badge-plain">${esc(t('common.points', { n: q.point }))}</span>
        <span class="badge badge-gray badge-plain font-mono">${esc(q.check_type)}</span>
      </div>
      ${keyHtml(item)}
    </div>`;
  }

  function autoHtml(item) {
    const sub = item.submission;
    const pass = isPass(sub);
    const auto = Number(sub?.auto_score ?? 0);
    const final = isReviewed(sub) ? Number(sub.final_score) : auto;
    return `<span class="rv-auto rv-auto--${pass ? 'pass' : 'fail'}">${pass ? '✓' : '✗'} ${esc(t(pass ? 'review.autoPass' : 'review.autoFail'))}</span>
      <span class="rv-score"><span class="rv-score__auto">${esc(window.rv.fmtNum(auto))}</span><span aria-hidden="true">→</span>
      <strong>${esc(window.rv.fmtNum(final))}</strong><span class="meta-faint">/${esc(item.question.point)}</span></span>`;
  }

  function questionRowHtml(item, commands) {
    const c = categories(item);
    return `<article class="rv-qrow${c.needsCorrection ? ' is-open' : ''}" id="rv-q-${item.question.id}" data-qid="${item.question.id}" tabindex="-1">
      <div class="rv-qrow__left">
        <header class="rv-qhead">
          <span class="badge badge-plain rv-qnum">#${esc(item.question.order_index)}</span>
          ${autoHtml(item)}
          ${window.rv.labelPill(item.detection.label)}
        </header>
        ${detectionHtml(item)}
        ${historyHtml(item, commands)}
        ${correctionHtml(item)}
      </div>
      ${rightHtml(item)}
    </article>`;
  }

  Object.assign(window.rv, { questionRowHtml, questionCategories: categories, expandedHistory });
})();

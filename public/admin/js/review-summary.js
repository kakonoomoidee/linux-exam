// Review Nilai v2 — session summary shown on level 2: correct rate per
// question, most "hampir benar" questions, and patterns suspected too strict.
(function () {
  const { esc } = window.rv;
  const SNIPPET_CHARS = 70;

  const snippet = (q) => {
    const text = window.rv.storyOf(q);
    return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text;
  };
  const qLabel = (q) => t('review.variantQuestion', { v: q.variantIndex, n: q.orderIndex });

  function rateBar(rate) {
    return `<span class="rv-bar" role="img" aria-label="${esc(t('review.correctRateN', { n: rate }))}">
      <span class="rv-bar__fill" style="width:${Number(rate)}%"></span></span>
      <span class="rv-bar__num">${esc(rate)}%</span>`;
  }

  function perQuestionTable(rows) {
    if (!rows.length) return `<p class="meta-faint">${esc(t('review.summaryEmpty'))}</p>`;
    return `<div class="overflow-x-auto"><table class="data-table rv-summary-table">
      <thead><tr>
        <th>${esc(t('review.question'))}</th><th>${esc(t('review.correctRate'))}</th>
        <th>${esc(t('review.label.near_miss'))}</th><th>${esc(t('review.label.correct_in_history'))}</th>
      </tr></thead>
      <tbody>${rows
        .map((q) => `<tr>
          <td><span class="font-mono whitespace-nowrap">${esc(qLabel(q))}</span>
            <span class="rv-summary-story">${esc(snippet(q))}</span></td>
          <td class="whitespace-nowrap">${rateBar(q.correctRate)} <span class="meta-faint">(${q.correct}/${q.participants})</span></td>
          <td>${q.nearMiss ? `<span class="badge badge-amber badge-plain">${q.nearMiss}</span>` : '<span class="meta-faint">0</span>'}</td>
          <td>${q.inHistory ? `<span class="badge badge-blue badge-plain">${q.inHistory}</span>` : '<span class="meta-faint">0</span>'}</td>
        </tr>`)
        .join('')}</tbody></table></div>`;
  }

  function topNearMissList(rows) {
    if (!rows.length) return `<p class="meta-faint">${esc(t('review.nearMissNone'))}</p>`;
    return `<ol class="rv-summary-list">${rows
      .map((q) => `<li><span class="font-mono">${esc(qLabel(q))}</span> — ${esc(snippet(q))}
        <span class="badge badge-amber badge-plain">${q.nearMiss + q.inHistory}</span></li>`)
      .join('')}</ol>`;
  }

  function suspiciousItem(f) {
    if (f.kind === 'normalization') {
      return `<li><span class="font-mono">${esc(qLabel(f))}</span>
        <span class="badge badge-red badge-plain">${esc(t('review.suspect.normalization'))}</span>
        <div class="rv-suspect-detail"><code>${esc(f.pattern)}</code>
          ${esc(t('review.suspect.normalizationHint', { example: f.example }))}</div></li>`;
    }
    const samples = f.samples.map((s) => `<code>${esc(s)}</code>`).join(' ');
    return `<li><span class="font-mono">${esc(qLabel(f))}</span>
      <span class="badge badge-amber badge-plain">${esc(t('review.suspect.students', { n: f.students }))}</span>
      <div class="rv-suspect-detail">${esc(window.rv.reasonText(f.reason))}</div>
      ${samples ? `<div class="rv-suspect-detail">${esc(t('review.suspect.examples'))} ${samples}</div>` : ''}</li>`;
  }

  /** @param {{perQuestion, topNearMiss, suspiciousPatterns}} summary */
  function summaryHtml(summary) {
    const count = summary.suspiciousPatterns.length;
    return `<details class="card rv-summary" open>
      <summary class="rv-summary__head">
        <span class="card-title">${esc(t('review.summaryTitle'))}</span>
        ${count ? `<span class="badge badge-red">${esc(t('review.suspectN', { n: count }))}</span>` : ''}
      </summary>
      <div class="rv-summary__grid">
        <section><h3 class="section-label">${esc(t('review.correctRatePerQuestion'))}</h3>${perQuestionTable(summary.perQuestion)}</section>
        <div class="rv-summary__side">
          <section><h3 class="section-label">${esc(t('review.topNearMiss'))}</h3>${topNearMissList(summary.topNearMiss)}</section>
          <section><h3 class="section-label">${esc(t('review.suspectTitle'))}</h3>
            ${count ? `<ul class="rv-summary-list">${summary.suspiciousPatterns.map(suspiciousItem).join('')}</ul>`
              : `<p class="meta-faint">${esc(t('review.suspectNone'))}</p>`}
          </section>
        </div>
      </div>
    </details>`;
  }

  window.rv.summaryHtml = summaryHtml;
})();

// Readable answer key editor (instruktur): 1–3 example commands per accepted
// pattern, one per line. The server checks every example with the grader and
// rejects ones that don't match. Opened from the Bank Soal kebab menu and from
// Review Nilai level 3.
(function () {
  const esc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
  const parseList = (raw) => {
    try {
      const v = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };

  function keyPreview(key) {
    if (!key.patterns.length) return `<p class="meta-faint">${esc(t('review.examplesStateHint'))}</p>`;
    return `<ul class="rv-key__list">${key.patterns.map((p) => `<li class="rv-key-item">
      <code class="rv-regex-inline">${esc(p.pattern)}</code>
      <div class="rv-examples">${p.examples.map((ex) => `<code class="rv-example">${esc(ex)}</code>`).join('')}
        ${p.derived ? `<span class="rv-tag rv-tag--auto">${esc(t('review.exampleDerived'))}</span>` : ''}</div>
    </li>`).join('')}</ul>`;
  }

  function errorText(details) {
    return details
      .map((d) => `${d.answer || '—'}: ${t(`review.exampleError.${d.error}`)}`)
      .join('\n');
  }

  /**
   * @param {number} questionId
   * @param {() => void} [onSaved] called after a successful save
   */
  async function openSampleAnswersEditor(questionId, onSaved) {
    let data;
    try {
      data = await apiFetch(`/admin/questions/${questionId}/answer-key`);
    } catch (err) {
      return window.ui.alert(err.message, { icon: 'error' });
    }
    const current = parseList(data.question.sample_answers);
    const suggestions = data.key.patterns.filter((p) => p.derived).flatMap((p) => p.examples);
    const result = await window.ui.modal.fire({
      titleText: t('review.editExamplesTitle'),
      width: 'min(720px, 94vw)',
      html: `<div class="rv-examples-editor">
        <p class="meta">${esc(t('review.examplesHelp'))}</p>
        ${keyPreview(data.key)}
        <label class="label" for="qx-answers">${esc(t('review.examplesLabel'))}</label>
        <textarea id="qx-answers" class="field font-mono" rows="6">${esc((current.length ? current : suggestions).join('\n'))}</textarea>
      </div>`,
      showCancelButton: true,
      confirmButtonText: t('common.save'),
      cancelButtonText: t('common.cancel'),
      focusConfirm: false,
      showLoaderOnConfirm: true,
      preConfirm: async () => {
        const answers = document.getElementById('qx-answers').value.split('\n').map((s) => s.trim()).filter(Boolean);
        const res = await fetch(`${API}/admin/questions/${questionId}/sample-answers`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ sample_answers: answers }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return body;
        window.Swal.showValidationMessage(body.details ? errorText(body.details) : window.i18n.apiError(body.error) || `HTTP ${res.status}`);
        return false;
      },
    });
    if (!result.isConfirmed) return;
    window.ui.toast(t('review.examplesSaved'));
    onSaved?.();
  }

  window.openSampleAnswersEditor = openSampleAnswersEditor;
})();

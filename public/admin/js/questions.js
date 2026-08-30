const qEsc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
let bankUcp = 1; // Bank Soal is segmented by UCP; questions carry q.ucp (default 1)
const Q_LEVEL_TONE = { easy: 'green', medium: 'amber', hard: 'red' };
const qLevelBadge = (lvl) =>
  window.ui.pill(t('admin.level.' + (lvl || 'medium')) || lvl || 'medium', Q_LEVEL_TONE[lvl] || 'amber');

// --- Download template link (needs the token in the query string for <a download>) ---
function refreshTemplateLink() {
  const a = document.getElementById('download-template-link');
  if (a) a.href = `${API}/admin/questions/template.xlsx?token=${adminToken}`;
}
document.addEventListener('DOMContentLoaded', refreshTemplateLink);

// --- Excel import ---
document.getElementById('import-questions-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('excel-file');
  if (!fileInput.files.length) return window.ui.alert(t('admin.pickExcelFirst'), { icon: 'warning' });

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const data = await apiFetch('/admin/questions/import', { method: 'POST', body: formData });
    document.getElementById('import-result').textContent =
      t('admin.importSuccess', { created: data.created, total: data.totalRows }) +
      '\n' +
      (data.errors.length
        ? t('admin.importErrors', { detail: JSON.stringify(data.errors, null, 2) })
        : t('admin.importAllOk'));
    loadQuestionBank();
  } catch (err) {
    document.getElementById('import-result').textContent = t('common.errorPrefix', { msg: err.message });
  }
});

// --- Add / edit form (SweetAlert2) ---
function questionFormHtml(q = {}) {
  const opt = (v, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`;
  return `
    <div style="text-align:left;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px">
        <label style="flex:1">${qEsc(t('common.ucp'))}
          <select id="qf-ucp" class="swal2-select" style="margin:4px 0">
            ${[1, 2].map((u) => `<option value="${u}"${(q.ucp ?? bankUcp) === u ? ' selected' : ''}>UCP ${u}</option>`).join('')}
          </select>
        </label>
        <label style="flex:1">${qEsc(t('common.variant'))}
          <input id="qf-variant" class="swal2-input" style="margin:4px 0" type="number" min="0" max="9" value="${q.variant_index ?? 0}">
        </label>
        <label style="flex:1">${qEsc(t('admin.order'))}
          <input id="qf-order" class="swal2-input" style="margin:4px 0" type="number" min="1" value="${q.order_index ?? 1}">
        </label>
      </div>
      <label>${qEsc(t('admin.storyId'))}
        <textarea id="qf-story-id" class="swal2-textarea" style="margin:4px 0">${qEsc(q.story_text || '')}</textarea>
      </label>
      <label>${qEsc(t('admin.storyEn'))}
        <textarea id="qf-story-en" class="swal2-textarea" style="margin:4px 0">${qEsc(q.story_text_en || '')}</textarea>
      </label>
      <div style="display:flex;gap:8px">
        <label style="flex:1">${qEsc(t('common.points'))}
          <input id="qf-point" class="swal2-input" style="margin:4px 0" type="number" step="0.5" value="${q.point ?? 1}">
        </label>
        <label style="flex:1">${qEsc(t('admin.level'))}
          <select id="qf-level" class="swal2-select" style="margin:4px 0">
            ${['easy', 'medium', 'hard'].map((l) => `<option value="${l}"${(q.level || 'medium') === l ? ' selected' : ''}>${qEsc(t('admin.level.' + l))}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>${qEsc(t('admin.checkType'))}
        <select id="qf-check-type" class="swal2-select" style="margin:4px 0">
          ${['command_match', 'state_check', 'both'].map((c) => opt(c, q.check_type || 'command_match')).join('')}
        </select>
      </label>
      <label>${qEsc(t('admin.acceptedPatterns'))}
        <input id="qf-patterns" class="swal2-input" style="margin:4px 0" value="${qEsc(patternsToText(q.accepted_patterns))}" placeholder="^ls$ | ^ls -la$">
      </label>
      <label>${qEsc(t('admin.stateChecker'))}
        <textarea id="qf-state-checker" class="swal2-textarea" style="margin:4px 0">${qEsc(q.state_checker_script || '')}</textarea>
      </label>
    </div>`;
}

function patternsToText(v) {
  try {
    const arr = Array.isArray(v) ? v : JSON.parse(v || '[]');
    return arr.join(' | ');
  } catch {
    return '';
  }
}

function readQuestionForm() {
  const patterns = document.getElementById('qf-patterns').value
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ucp: parseInt(document.getElementById('qf-ucp').value, 10) === 2 ? 2 : 1,
    variant_index: parseInt(document.getElementById('qf-variant').value, 10) || 0,
    order_index: parseInt(document.getElementById('qf-order').value, 10) || 1,
    story_text: document.getElementById('qf-story-id').value.trim(),
    story_text_en: document.getElementById('qf-story-en').value.trim() || null,
    point: parseFloat(document.getElementById('qf-point').value) || 1,
    level: document.getElementById('qf-level').value,
    check_type: document.getElementById('qf-check-type').value,
    accepted_patterns: patterns,
    state_checker_script: document.getElementById('qf-state-checker').value.trim() || null,
  };
}

async function openQuestionForm(existing) {
  const { isConfirmed } = await window.Swal.fire({
    title: existing ? t('admin.editQuestion') : t('admin.addQuestion'),
    html: questionFormHtml(existing || {}),
    width: 'min(680px, 94vw)',
    showCancelButton: true,
    confirmButtonText: t('common.save'),
    cancelButtonText: t('common.cancel'),
    customClass: { popup: 'ui-swal-popup', confirmButton: 'ui-swal-confirm', cancelButton: 'ui-swal-cancel' },
    buttonsStyling: false,
    focusConfirm: false,
    preConfirm: () => {
      const body = readQuestionForm();
      if (!body.story_text) {
        window.Swal.showValidationMessage(t('admin.storyRequired'));
        return false;
      }
      return body;
    },
  }).then((r) => ({ isConfirmed: r.isConfirmed, body: r.value }));

  if (!isConfirmed) return;
  const body = readQuestionForm();
  if (existing) {
    await apiFetch(`/admin/questions/${existing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } else {
    await apiFetch('/admin/questions', { method: 'POST', body: JSON.stringify(body) });
  }
  loadQuestionBank();
}

document.getElementById('add-question-btn').addEventListener('click', () => openQuestionForm(null));

// UCP segment: swap active styling + aria-pressed, reload the (client-filtered) list.
document.querySelectorAll('#bank-ucp-toggle button').forEach((btn) => {
  btn.addEventListener('click', () => {
    bankUcp = parseInt(btn.dataset.ucp, 10);
    document.querySelectorAll('#bank-ucp-toggle button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('btn-primary', on);
      b.classList.toggle('btn-ghost', !on);
      b.setAttribute('aria-pressed', String(on));
    });
    loadQuestionBank();
  });
});

// --- Question bank list (grouped by variant, avatar-less card rows) ---
async function loadQuestionBank() {
  refreshTemplateLink();
  const box = document.getElementById('question-bank-list');
  if (!box) return;
  box.innerHTML = `<div class="row-list">${Array.from({ length: 3 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  const all = await apiFetch(`/admin/questions?ucp=${bankUcp}`);
  const questions = all.filter((q) => (q.ucp ?? 1) === bankUcp); // belt & braces if the param is ignored
  const isInstruktur = window.adminRole === 'instruktur';

  if (questions.length === 0) {
    box.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <div class="empty-state__title">${qEsc(t('admin.bankEmptyTitle'))}</div>
      <div class="empty-state__hint">${qEsc(t('admin.bankEmptyHint'))}</div>
    </div>`;
    return;
  }

  // group by variant_index — the list endpoint walks variants 0..9 in order
  const byVariant = new Map();
  for (const q of questions) {
    const v = q.variant_index ?? '?';
    if (!byVariant.has(v)) byVariant.set(v, []);
    byVariant.get(v).push(q);
  }

  box.innerHTML = [...byVariant.entries()]
    .map(
      ([v, qs]) => `
      <div class="mb-5">
        <div class="section-label mb-2">${qEsc(t('admin.variantN', { n: v }))}</div>
        <div class="row-list">
          ${qs.map((q) => questionRow(q, isInstruktur)).join('')}
        </div>
      </div>`
    )
    .join('');

  if (isInstruktur) {
    box.querySelectorAll('.q-edit').forEach((btn) =>
      btn.addEventListener('click', () => {
        const q = questions.find((x) => String(x.id) === btn.dataset.id);
        openQuestionForm(q);
      })
    );
    box.querySelectorAll('.q-delete').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const ok = await window.ui.confirm(t('admin.deleteQuestionConfirm'), {
          icon: 'warning',
          confirmText: t('common.delete'),
        });
        if (!ok) return;
        await apiFetch(`/admin/questions/${btn.dataset.id}`, { method: 'DELETE' });
        loadQuestionBank();
      })
    );
  }
}

function questionRow(q, isInstruktur) {
  const snippet = (q.story_text || '').slice(0, 120);
  const kebab = isInstruktur
    ? `<details class="kebab">
         <summary aria-label="${t('common.actions')}">⋮</summary>
         <div class="kebab-menu">
           <button class="kebab-item q-edit" data-id="${q.id}">${t('common.edit')}</button>
           <button class="kebab-item danger q-delete" data-id="${q.id}">${t('common.delete')}</button>
         </div>
       </details>`
    : '';
  return `<div class="card-row">
    <span class="avatar avatar-sm" style="background:var(--accent)" aria-hidden="true">${q.order_index}</span>
    <div class="card-row__identity">
      <div class="card-row__name">${qEsc(snippet)}${q.story_text && q.story_text.length > 120 ? '…' : ''}</div>
      <div class="card-row__meta">
        <span>${t('common.points', { n: q.point })}</span>
        <span>${qEsc(q.check_type)}</span>
        ${q.story_text_en ? `<span>EN ✓</span>` : `<span class="text-[color:var(--text-faint)]">EN —</span>`}
      </div>
    </div>
    <div class="card-row__aside">
      ${qLevelBadge(q.level)}
      ${kebab}
    </div>
  </div>`;
}

window.loadQuestionBank = loadQuestionBank;

window.addEventListener('i18n:changed', () => {
  if (document.getElementById('question-bank-list') && document.getElementById('question-bank-list').innerHTML) {
    loadQuestionBank();
  }
});

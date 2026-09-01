// Global student roster: import, template download, grouped+paginated list, inline edit.
const stuEsc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
const STU_PAGE_SIZE = 50;
let stuRoster = [];
let stuPage = 1;

// Kelas picker: the fixed A–F list (plus any legacy value still on the row).
const KELAS_BASE = ['A', 'B', 'C', 'D', 'E', 'F'];

function refreshStudentTemplateLink() {
  const a = document.getElementById('student-template-link');
  if (a) a.href = `${API}/admin/students/template.xlsx?token=${adminToken}`;
}
document.addEventListener('DOMContentLoaded', refreshStudentTemplateLink);

document.getElementById('import-students-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('student-file');
  if (!fileInput.files.length) return window.ui.alert(t('admin.pickStudentFile'), { icon: 'warning' });

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const out = document.getElementById('import-students-result');
  try {
    const data = await apiFetch('/admin/students/import', { method: 'POST', body: formData });
    out.textContent =
      t('admin.studentImportSuccess', { created: data.created, backfilled: data.backfilled, total: data.totalRows }) +
      '\n' +
      (data.errors.length
        ? t('admin.importErrors', { detail: JSON.stringify(data.errors, null, 2) })
        : t('admin.importAllOk'));
    fileInput.value = '';
    loadStudents();
  } catch (err) {
    out.textContent = t('common.errorPrefix', { msg: err.message });
  }
});

async function loadStudents() {
  refreshStudentTemplateLink();
  const box = document.getElementById('student-roster-list');
  if (!box) return;
  box.innerHTML = `<div class="row-list">${Array.from({ length: 3 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  stuRoster = await apiFetch('/admin/students');

  if (stuRoster.length === 0) {
    box.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <div class="empty-state__title">${stuEsc(t('admin.studentRosterEmpty'))}</div>
    </div>`;
    return;
  }
  if ((stuPage - 1) * STU_PAGE_SIZE >= stuRoster.length) stuPage = 1;
  renderStudents();
}

function renderStudents() {
  const box = document.getElementById('student-roster-list');
  // roster arrives sorted kelas NULLS LAST, then nim (server-side).
  const pageCount = Math.max(1, Math.ceil(stuRoster.length / STU_PAGE_SIZE));
  const slice = stuRoster.slice((stuPage - 1) * STU_PAGE_SIZE, stuPage * STU_PAGE_SIZE);

  let html = '';
  let lastKelas = Symbol('none');
  for (const s of slice) {
    if (s.kelas !== lastKelas) {
      lastKelas = s.kelas;
      if (html) html += '</div></div>';
      const label = s.kelas ? `${t('common.kelas')} ${s.kelas}` : t('admin.kelasNone');
      html += `<div class="mb-5"><div class="section-label mb-2">${stuEsc(label)}</div><div class="row-list">`;
    }
    html += studentRow(s);
  }
  if (html) html += '</div></div>';
  box.innerHTML = html;

  const pager = window.ui.pager({
    page: stuPage,
    pageCount,
    onChange: (p) => {
      stuPage = p;
      renderStudents();
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  });
  if (pager) box.appendChild(pager);

  box.querySelectorAll('.stu-edit').forEach((btn) =>
    btn.addEventListener('click', () => {
      const s = stuRoster.find((x) => String(x.id) === btn.dataset.id);
      openStudentForm(s);
    })
  );
}

function studentRow(s) {
  return `<div class="card-row">
    ${window.ui.avatarHtml(s.name || s.nim)}
    <div class="card-row__identity">
      <div class="card-row__name">${stuEsc(s.name || '-')}</div>
      <div class="card-row__meta"><span class="mono">${stuEsc(s.nim)}</span></div>
    </div>
    <div class="card-row__aside">
      ${s.kelas ? window.ui.pill(s.kelas, 'blue') : `<span class="text-[color:var(--text-faint)] text-sm">${stuEsc(t('admin.kelasNone'))}</span>`}
      <details class="kebab">
        <summary aria-label="${t('common.actions')}">⋮</summary>
        <div class="kebab-menu">
          <button class="kebab-item stu-edit" data-id="${s.id}">${t('common.edit')}</button>
        </div>
      </details>
    </div>
  </div>`;
}

async function openStudentForm(s) {
  const kelasOpts = [...new Set([...KELAS_BASE, ...stuRoster.map((r) => r.kelas).filter(Boolean)])].sort();
  const kelasOptionsHtml = [
    `<option value="">${stuEsc(t('admin.kelasNone'))}</option>`,
    ...kelasOpts.map((k) => `<option value="${stuEsc(k)}"${s.kelas === k ? ' selected' : ''}>${stuEsc(k)}</option>`),
  ].join('');
  const { isConfirmed, value } = await window.ui.modal.fire({
    title: t('admin.editStudent'),
    html: `
      <div style="text-align:left;display:flex;flex-direction:column;gap:14px">
        <div>
          <label class="label" for="sf-nim">${stuEsc(t('common.nim'))}</label>
          <input id="sf-nim" class="field" value="${stuEsc(s.nim)}" disabled>
        </div>
        <div>
          <label class="label" for="sf-name">${stuEsc(t('common.name'))}</label>
          <input id="sf-name" class="field" value="${stuEsc(s.name || '')}">
        </div>
        <div>
          <label class="label" for="sf-kelas">${stuEsc(t('common.kelas'))}</label>
          <select id="sf-kelas" class="field">${kelasOptionsHtml}</select>
        </div>
        <div>
          <label class="label" for="sf-tg-username">${stuEsc(t('admin.telegramUsername'))}</label>
          <input id="sf-tg-username" class="field" value="${stuEsc(s.telegram_username || '')}" placeholder="username">
        </div>
        <div>
          <label class="label" for="sf-tg-chat-id">${stuEsc(t('admin.telegramChatId'))}</label>
          <input id="sf-tg-chat-id" class="field" inputmode="numeric" value="${stuEsc(s.telegram_chat_id || '')}">
          <small class="meta-faint" style="display:block;margin-top:0.35rem">${stuEsc(t('admin.telegramFieldHelp'))}</small>
        </div>
      </div>`,
    width: 'min(480px, 94vw)',
    showCancelButton: true,
    confirmButtonText: t('common.save'),
    cancelButtonText: t('common.cancel'),
    focusConfirm: false,
    didOpen: () => {
      window.ui.enhanceAllSelects(window.Swal.getPopup());
    },
    preConfirm: () => {
      const kelas = document.getElementById('sf-kelas').value;
      const chatId = document.getElementById('sf-tg-chat-id').value.trim();
      if (chatId && !/^-?\d+$/.test(chatId)) {
        window.Swal.showValidationMessage(t('admin.telegramChatId'));
        return false;
      }
      return {
        name: document.getElementById('sf-name').value.trim(),
        kelas,
        telegram_username: document.getElementById('sf-tg-username').value.trim().replace(/^@/, ''),
        telegram_chat_id: chatId,
      };
    },
  });
  if (!isConfirmed) return;
  await apiFetch(`/admin/students/${s.id}`, { method: 'PATCH', body: JSON.stringify(value) });
  window.ui.toast(t('admin.studentSaved'), 'success');
  loadStudents();
}

window.loadStudents = loadStudents;

window.addEventListener('i18n:changed', () => {
  if (document.getElementById('student-roster-list') && document.getElementById('student-roster-list').innerHTML) {
    renderStudents();
  }
});

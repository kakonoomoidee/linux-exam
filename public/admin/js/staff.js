const sEsc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));

document.getElementById('add-staff-btn').addEventListener('click', async () => {
  const nim = document.getElementById('staff-nim').value.trim();
  const name = document.getElementById('staff-name').value.trim();
  const password = document.getElementById('staff-password').value;
  const role = document.getElementById('staff-role').value;
  if (!nim || !password) {
    return window.ui.alert(t('admin.staffMissingFields'), { icon: 'warning' });
  }
  await apiFetch('/admin/staff', {
    method: 'POST',
    body: JSON.stringify({ nim, name, password, role }),
  });
  document.getElementById('staff-nim').value = '';
  document.getElementById('staff-name').value = '';
  document.getElementById('staff-password').value = '';
  window.ui.toast(t('admin.staffAdded'), 'success');
  loadStaff();
});

async function loadStaff() {
  const box = document.getElementById('staff-list');
  if (!box) return;
  box.innerHTML = `<div class="row-list">${Array.from({ length: 2 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  const staff = await apiFetch('/admin/staff');

  if (staff.length === 0) {
    box.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
      <div class="empty-state__title">${sEsc(t('admin.staffEmpty'))}</div>
    </div>`;
    return;
  }

  box.innerHTML = `<div class="row-list">${staff
    .map((u) => {
      const roleTone = u.role === 'instruktur' ? 'blue' : 'gray';
      return `<div class="card-row">
        ${window.ui.avatarHtml(u.name || u.nim)}
        <div class="card-row__identity">
          <div class="card-row__name">${sEsc(u.name || u.nim)}</div>
          <div class="card-row__meta"><span class="mono">${sEsc(u.nim)}</span></div>
        </div>
        <div class="card-row__aside">
          ${window.ui.pill(t('admin.role.' + u.role) || u.role, roleTone)}
          <details class="kebab">
            <summary aria-label="${t('common.actions')}">⋮</summary>
            <div class="kebab-menu">
              <button class="kebab-item danger staff-delete" data-id="${u.id}">${t('common.delete')}</button>
            </div>
          </details>
        </div>
      </div>`;
    })
    .join('')}</div>`;

  box.querySelectorAll('.staff-delete').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const ok = await window.ui.confirm(t('admin.deleteStaffConfirm'), {
        icon: 'warning',
        confirmText: t('common.delete'),
      });
      if (!ok) return;
      try {
        await apiFetch(`/admin/staff/${btn.dataset.id}`, { method: 'DELETE' });
        loadStaff();
      } catch (err) {
        window.ui.alert(err.message, { icon: 'error' });
      }
    })
  );
}

window.loadStaff = loadStaff;

window.addEventListener('i18n:changed', () => {
  if (document.getElementById('staff-list') && document.getElementById('staff-list').innerHTML) loadStaff();
});

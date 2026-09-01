// Audit log viewer (instruktur-only). Server-side filtered + paginated, unlike
// the client-side roster/grades tables — audit_logs grows unbounded.
const audEsc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));
let auditPage = 1;
let auditActionsLoaded = false;
let auditSearchTimer = null;

function actionLabel(a) {
  const key = `admin.action.${a}`;
  const label = t(key);
  return label === key ? a : label;
}

function maskChat(id) {
  const s = String(id || '');
  return s.length > 4 ? `•••${s.slice(-4)}` : s || '—';
}

function auditDetail(row) {
  const m = row.metadata || {};
  switch (row.action) {
    case 'login':
      return m.ip ? `IP ${audEsc(m.ip)}` : '—';
    case 'telegram_bind_self':
      return `chat ${audEsc(maskChat(m.chat_id))}`;
    case 'telegram_unlink_self':
      return `${audEsc(m.source === 'telegram_confirm' ? 'Telegram' : 'web')} · ${audEsc(t('admin.auditDetailUnlinked'))} ${audEsc(maskChat(m.previous_chat_id))}`;
    case 'telegram_bind_staff_override': {
      const src = m.source === 'excel_import' ? 'Excel' : t('admin.editStudent');
      return `${audEsc(src)} · chat ${audEsc(maskChat(m.chat_id))}`;
    }
    default:
      return '—';
  }
}

async function populateAuditActions() {
  const sel = document.getElementById('audit-action');
  let actions = [];
  try {
    actions = await apiFetch('/admin/audit/actions');
  } catch {
    /* dropdown just stays at "all" */
  }
  sel.innerHTML =
    `<option value="">${audEsc(t('admin.auditAllActions'))}</option>` +
    actions.map((a) => `<option value="${audEsc(a)}">${audEsc(actionLabel(a))}</option>`).join('');
  window.ui.enhanceAllSelects?.(sel.parentElement);
  auditActionsLoaded = true;
}

function auditParams() {
  const p = new URLSearchParams();
  const nim = document.getElementById('audit-nim').value.trim();
  const action = document.getElementById('audit-action').value;
  const from = document.getElementById('audit-from').value;
  const to = document.getElementById('audit-to').value;
  if (nim) p.set('nim', nim);
  if (action) p.set('action', action);
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  p.set('page', String(auditPage));
  return p.toString();
}

async function loadAudit() {
  const box = document.getElementById('audit-list');
  if (!box) return;
  if (!auditActionsLoaded) await populateAuditActions();
  box.innerHTML = `<div class="row-list">${Array.from({ length: 4 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;

  let data;
  try {
    data = await apiFetch(`/admin/audit?${auditParams()}`);
  } catch (err) {
    box.innerHTML = `<p class="text-sm text-[color:var(--danger)]">${audEsc(err.message)}</p>`;
    return;
  }

  if (!data.rows.length) {
    box.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>
      <div class="empty-state__title">${audEsc(t('admin.auditEmpty'))}</div>
    </div>`;
    return;
  }

  const rows = data.rows
    .map((r) => {
      const actorName = r.actor_name || r.actor_nim || t('admin.auditSystem');
      const actorMeta = r.actor_nim ? `<span class="mono">${audEsc(r.actor_nim)}</span>` : '';
      const target = r.target_name || r.target_nim ? `${audEsc(r.target_name || '')} <span class="mono">${audEsc(r.target_nim || '')}</span>` : '—';
      return `<tr>
        <td class="whitespace-nowrap">${audEsc(new Date(r.created_at).toLocaleString())}</td>
        <td>
          <div class="flex items-center gap-2">${window.ui.avatarHtml(actorName)}
            <span><span class="card-row__name">${audEsc(actorName)}</span> ${actorMeta}</span>
          </div>
          <div class="mt-1">${window.ui.pill(r.actor_type, r.actor_type === 'staff' ? 'blue' : r.actor_type === 'system' ? 'gray' : 'plain')}</div>
        </td>
        <td>${window.ui.pill(actionLabel(r.action), r.action.startsWith('password_reset') || r.action === 'telegram_unlink_self' ? 'amber' : r.action === 'login' ? 'green' : 'blue')}</td>
        <td>${target}</td>
        <td class="text-[color:var(--text-muted)] text-sm">${auditDetail(r)}</td>
      </tr>`;
    })
    .join('');

  box.innerHTML = `<div class="overflow-x-auto"><table class="data-table">
    <thead><tr>
      <th data-i18n="admin.auditColTime">Waktu</th>
      <th data-i18n="admin.auditColActor">Aktor</th>
      <th data-i18n="admin.auditColAction">Aksi</th>
      <th data-i18n="admin.auditColTarget">Target</th>
      <th data-i18n="admin.auditColDetail">Detail</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;

  const pager = window.ui.pager({
    page: data.page,
    pageCount: data.pageCount,
    onChange: (p) => {
      auditPage = p;
      loadAudit();
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
  });
  if (pager) box.appendChild(pager);
}

function reloadAuditFromFirstPage() {
  auditPage = 1;
  loadAudit();
}

document.getElementById('audit-apply').addEventListener('click', reloadAuditFromFirstPage);
document.getElementById('audit-action').addEventListener('change', reloadAuditFromFirstPage);
['audit-from', 'audit-to'].forEach((id) =>
  document.getElementById(id).addEventListener('change', reloadAuditFromFirstPage)
);
document.getElementById('audit-nim').addEventListener('input', () => {
  clearTimeout(auditSearchTimer);
  auditSearchTimer = setTimeout(reloadAuditFromFirstPage, 250);
});

window.loadAudit = loadAudit;

window.addEventListener('i18n:changed', () => {
  if (document.getElementById('audit-list') && document.getElementById('audit-list').innerHTML) {
    auditActionsLoaded = false; // relabel the dropdown too
    loadAudit();
  }
});

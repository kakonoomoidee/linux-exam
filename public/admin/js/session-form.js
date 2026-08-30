// Standalone page: /admin/sessions/new (create) and /admin/sessions/:id (manage).
// Creating a session, its roster, the join code and "Mulai Ujian" all live here —
// the dashboard "Sesi" tab is just an index now.
(function () {
  if (!adminToken) {
    location.href = '/admin';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.ui.escapeHtml(String(s == null ? '' : s));

  const match = location.pathname.match(/\/admin\/sessions\/(new|\d+)/);
  let sessionId = match && match[1] !== 'new' ? match[1] : null;
  let socket = null;

  const CONTAINER_TONE = {
    active: 'green', running: 'green', ready: 'blue', provisioning: 'amber',
    not_started: 'gray', ending: 'amber', ended: 'gray', destroyed: 'gray', error: 'red',
  };
  const containerPill = (status) => {
    const k = 'admin.status.' + status;
    return window.ui.pill(t(k) === k ? status : t(k), CONTAINER_TONE[status] || 'gray');
  };
  const STATUS_TONE = { pending: 'gray', running: 'green', ended: 'gray' };

  function showManageLayout() {
    $('create-card').classList.add('hidden');
    $('summary-card').classList.remove('hidden');
    $('joincode-card').classList.remove('hidden');
    $('roster-card').classList.remove('hidden');
    const title = $('page-title');
    title.removeAttribute('data-i18n'); // stop applyStatic putting the create heading back
    title.textContent = t('admin.manageSessionHeading');
  }

  function renderSummary(s) {
    $('summary-name').textContent = s.name;
    $('summary-meta').innerHTML = [
      window.ui.pill(t('common.minutes', { n: s.duration_minutes }), 'gray'),
      window.ui.pill(t('admin.ucpN', { n: s.ucp ?? 1 }), 'gray'),
      window.ui.pill(t('admin.status.' + s.status), STATUS_TONE[s.status] || 'gray'),
    ].join('');
    $('join-code-value').textContent = s.join_code || '------';
    $('start-exam-btn').hidden = s.status !== 'pending'; // only meaningful while pending
  }

  function renderParticipantRow(p) {
    const violationPill = p.violation_count
      ? window.ui.pill(`⚠ ${t('admin.tabSwitches', { n: p.violation_count })}`, 'amber')
      : '';
    const meta = [
      `<span class="mono">${esc(p.nim)}</span>`,
      `<span>${t('common.variant')} ${p.variant_index}</span>`,
      p.kelas ? `<span>${esc(p.kelas)}</span>` : '',
    ].filter(Boolean).join('');
    return `<div class="card-row">
      ${window.ui.avatarHtml(p.name || p.nim)}
      <div class="card-row__identity">
        <div class="card-row__name">${esc(p.name || '-')}</div>
        <div class="card-row__meta">${meta}</div>
      </div>
      <div class="card-row__aside">
        ${violationPill}
        ${containerPill(p.container_status)}
      </div>
    </div>`;
  }

  async function loadSession() {
    const s = await apiFetch(`/admin/sessions/${sessionId}`);
    renderSummary(s);
    const participants = s.participants || [];
    $('participant-list').innerHTML = participants.length
      ? `<div class="row-list">${participants.map(renderParticipantRow).join('')}</div>`
      : `<p class="text-sm text-[color:var(--text-faint)]">${esc(t('admin.noParticipantsYet'))}</p>`;
  }

  function connectSocket() {
    if (socket) return;
    socket = io();
    socket.emit('admin:join', { token: adminToken });
    socket.on('admin:violation', () => { if (sessionId) loadSession(); });
  }

  $('create-btn').addEventListener('click', async () => {
    const name = $('f-name').value.trim();
    const duration_minutes = parseInt($('f-duration').value, 10) || 10;
    const ucp = parseInt($('f-ucp').value, 10) || 1;
    if (!name) {
      $('create-error').textContent = t('admin.sessionNameRequired');
      return;
    }
    try {
      const s = await apiFetch('/admin/sessions', {
        method: 'POST',
        body: JSON.stringify({ name, duration_minutes, ucp }),
      });
      sessionId = s.id;
      history.replaceState({}, '', `/admin/sessions/${s.id}`);
      showManageLayout();
      renderSummary(s);
      await loadSession();
      connectSocket();
    } catch (err) {
      $('create-error').textContent = err.message;
    }
  });

  $('add-participants-btn').addEventListener('click', async () => {
    const nims = $('participant-nims').value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        // "NIM" | "NIM, Nama" | "NIM, Nama, Kelas" (comma / semicolon / tab separated)
        const [nim, name, ...kelasParts] = line.split(/[,;\t]/).map((x) => x.trim());
        const kelas = kelasParts.join(',').trim();
        if (!name && !kelas) return nim;
        return { nim, name: name || undefined, kelas: kelas || undefined };
      });
    if (nims.length === 0) return;
    const { skipped = [] } = await apiFetch(`/admin/sessions/${sessionId}/participants`, {
      method: 'POST',
      body: JSON.stringify({ nims }),
    });
    $('participant-nims').value = '';
    if (skipped.length) {
      window.ui.alert(
        t('admin.participantsSkipped', { n: skipped.length }) +
          '\n' +
          skipped.map((r) => `${r.nim || '?'}: ${r.kelas ?? ''} — ${r.error}`).join('\n'),
        { icon: 'warning' }
      );
    }
    loadSession();
  });

  $('start-exam-btn').addEventListener('click', async () => {
    const ok = await window.ui.confirm(t('admin.startExamConfirm'), {
      icon: 'warning',
      confirmText: t('admin.startExam'),
    });
    if (!ok) return;
    await apiFetch(`/admin/sessions/${sessionId}/start`, { method: 'POST' });
    window.ui.toast(t('admin.examStarted'), 'success');
    loadSession();
  });

  window.addEventListener('i18n:changed', () => {
    if (sessionId) loadSession();
  });

  if (sessionId) {
    showManageLayout();
    loadSession()
      .then(connectSocket)
      .catch((err) => window.ui.alert(err.message, { icon: 'error' }).then(() => (location.href = '/admin')));
  }
})();

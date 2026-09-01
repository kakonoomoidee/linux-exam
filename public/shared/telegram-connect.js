// Shared Telegram-binding UI: status badge + connect/disconnect + the `/start <code>`
// modal (deep link + manual fallback) + 3s poll. Extracted from student/js/app.js so
// /admin reuses it verbatim; element IDs are identical on both pages. i18n keys keep
// their `student.telegram*` prefix (they resolve on /admin too).
//
// Expected DOM (rendered in each page's sidebar):
//   #telegram-connect-btn / #telegram-disconnect-btn  — .side-link buttons
//   #telegram-status                                  — status badge (kept right-aligned via ml-auto)
//   #telegram-bot-link                                — persistent "Bot: @name" link (optional)
(function () {
  const API = '/api';
  const t = (k, v) => window.i18n.t(k, v);
  const $ = (id) => document.getElementById(id);

  let getToken = () => null;
  let pollTimer = null;
  let botUsername = null; // cached from the last status/link-code response

  const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

  function renderStatus({ linked, username, botUsername: bot } = {}) {
    if (bot != null) botUsername = bot;
    const badge = $('telegram-status');
    const connectBtn = $('telegram-connect-btn');
    const disconnectBtn = $('telegram-disconnect-btn');
    if (linked) {
      badge.className = 'badge badge-green ml-auto';
      badge.textContent = username ? t('student.telegramLinkedAs', { username }) : t('student.telegramLinked');
      connectBtn.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
    } else {
      badge.className = 'badge badge-gray ml-auto';
      badge.textContent = t('student.telegramNotLinked');
      connectBtn.classList.remove('hidden');
      disconnectBtn.classList.add('hidden');
    }
    const link = $('telegram-bot-link');
    if (link) {
      if (botUsername) {
        link.href = `https://t.me/${encodeURIComponent(botUsername)}`;
        link.textContent = `${t('student.telegramBotLabel')} @${botUsername}`;
        link.hidden = false;
      } else {
        link.hidden = true;
      }
    }
  }

  async function refresh() {
    try {
      const res = await fetch(`${API}/me/telegram`, { headers: authHeaders() });
      if (!res.ok) return;
      renderStatus(await res.json());
    } catch {
      /* leave the default "not linked" state */
    }
  }

  async function connect() {
    let data;
    try {
      const res = await fetch(`${API}/me/telegram/link-code`, { method: 'POST', headers: authHeaders() });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      window.ui.alert(window.i18n.apiError(err && err.message) || t('common.requestFailed', { status: 0 }), { icon: 'error' });
      return;
    }
    if (data.botUsername) botUsername = data.botUsername;

    const esc = window.ui.escapeHtml;
    const botTarget = data.botUsername ? `@${esc(data.botUsername)}` : t('student.telegramYourBot');
    const command = `/start ${data.code}`;
    const deepLink = data.botUsername
      ? `https://t.me/${encodeURIComponent(data.botUsername)}?start=${encodeURIComponent(data.code)}`
      : null;

    const deepLinkBlock = deepLink
      ? `<a class="btn btn-primary btn-block" target="_blank" rel="noopener" href="${esc(deepLink)}">${esc(t('student.telegramOpenBtn'))}</a>
         <p class="text-xs text-[color:var(--text-faint)] mt-2 mb-1">${esc(t('student.telegramCodeTtl'))}</p>
         <div class="section-label mt-4 mb-2" style="text-align:left">${esc(t('student.telegramManualFallback'))}</div>`
      : '';

    const html = `
      ${deepLinkBlock}
      <ol class="text-sm" style="text-align:left;padding-left:1.3em;line-height:1.9;margin:0 0 4px">
        <li>${t('student.telegramStep1', { bot: botTarget })}</li>
        <li>${esc(t('student.telegramStep2'))}</li>
        <li>${esc(t('student.telegramStep3'))}</li>
      </ol>
      <div style="margin:10px 0;padding:12px;border-radius:10px;background:var(--surface-2);
        font-family:var(--mono);font-size:1.3rem;letter-spacing:.15em;text-align:center;word-break:break-all">${esc(command)}</div>
      <button type="button" id="tg-copy-btn" class="btn btn-ghost btn-sm btn-block">${esc(t('student.telegramCopyBtn'))}</button>
      ${deepLink ? '' : `<p class="text-xs text-[color:var(--text-faint)] mt-2">${esc(t('student.telegramCodeTtl'))}</p>`}`;

    window.ui.modal.fire({
      title: t('student.telegramModalTitle'),
      html,
      confirmButtonText: t('common.close'),
      didOpen: () => {
        const copyBtn = document.getElementById('tg-copy-btn');
        if (copyBtn) {
          copyBtn.addEventListener('click', () => {
            const done = () => window.ui.toast(t('student.telegramCopied'));
            if (navigator.clipboard) navigator.clipboard.writeText(command).then(done, () => {});
          });
        }
        clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
          try {
            const r = await fetch(`${API}/me/telegram`, { headers: authHeaders() });
            if (!r.ok) return;
            const s = await r.json();
            if (s.linked) {
              clearInterval(pollTimer);
              renderStatus(s);
              window.Swal.close();
              window.ui.toast(t('student.telegramConnected'), 'success');
            }
          } catch {
            /* keep polling */
          }
        }, 3000);
      },
      willClose: () => clearInterval(pollTimer),
    });
  }

  async function disconnect() {
    const ok = await window.ui.confirm(t('student.telegramDisconnectConfirm'), { icon: 'warning' });
    if (!ok) return;
    try {
      const res = await fetch(`${API}/me/telegram`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error();
      renderStatus({ linked: false }); // keeps the cached bot link visible
      window.ui.toast(t('student.telegramDisconnected'));
    } catch {
      window.ui.alert(t('common.requestFailed', { status: 0 }), { icon: 'error' });
    }
  }

  // getToken: () => string — the caller's current auth token (student `token`, admin `adminToken`).
  function init({ getToken: gt } = {}) {
    getToken = gt || (() => null);
    $('telegram-connect-btn').addEventListener('click', connect);
    $('telegram-disconnect-btn').addEventListener('click', disconnect);
    refresh();
  }

  window.telegramConnect = { init, refresh };
})();

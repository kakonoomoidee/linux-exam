/**
 * Thin wrapper over (self-hosted) SweetAlert2 so every modal/toast in the app
 * shares one look — themed with the same CSS custom properties as theme.css,
 * so it automatically follows light/dark if those tokens ever change.
 * Loaded after sweetalert2.all.min.js on both student and admin pages.
 */
(function () {
  const themed = window.Swal.mixin({
    background: 'var(--surface)',
    color: 'var(--text)',
    confirmButtonColor: 'var(--accent)',
    cancelButtonColor: 'var(--surface-2)',
    customClass: {
      popup: 'ui-swal-popup',
      confirmButton: 'ui-swal-confirm',
      cancelButton: 'ui-swal-cancel',
    },
    buttonsStyling: false,
  });

  const toastMixin = themed.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3500,
    timerProgressBar: true,
    didOpen: (el) => {
      el.addEventListener('mouseenter', window.Swal.stopTimer);
      el.addEventListener('mouseleave', window.Swal.resumeTimer);
    },
  });

  /** Replaces window.confirm() — returns a Promise<boolean>. */
  function uiConfirm(message, opts = {}) {
    return themed
      .fire({
        icon: opts.icon || 'question',
        title: opts.title || '',
        text: message,
        showCancelButton: true,
        confirmButtonText: opts.confirmText || 'OK',
        cancelButtonText: opts.cancelText || (window.i18n ? window.i18n.t('common.cancel') : 'Cancel'),
        reverseButtons: true,
      })
      .then((r) => r.isConfirmed);
  }

  /** Replaces window.alert() — a themed modal, awaits dismissal. */
  function uiAlert(message, opts = {}) {
    return themed.fire({
      icon: opts.icon || 'info',
      title: opts.title || '',
      text: message,
      confirmButtonText: opts.confirmText || 'OK',
    });
  }

  /** A block of pre-formatted text (e.g. a command log) in a scrollable modal. */
  function uiAlertPre(title, text) {
    return themed.fire({
      icon: 'info',
      title,
      html: `<pre style="text-align:left;white-space:pre-wrap;font-family:var(--mono);font-size:0.8rem;max-height:50vh;overflow:auto;margin:0;">${escapeHtml(text)}</pre>`,
      confirmButtonText: 'OK',
      width: 'min(640px, 92vw)',
    });
  }

  /** Lightweight, non-blocking toast — replaces the old hand-rolled .toast div. */
  function uiToast(message, icon = 'success') {
    toastMixin.fire({ icon, title: message });
  }

  /** Blocking "please wait" modal with a spinner; call the returned close() when done. */
  function uiLoading(message) {
    themed.fire({
      title: message,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => window.Swal.showLoading(),
    });
    return () => window.Swal.close();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Deterministic avatar for a person: initials + a colour hashed from the
   * key (name or NIM), so the same person always gets the same colour.
   * Returns { initials, bg } — bg is an hsl() string.
   */
  function uiAvatar(key) {
    const s = String(key == null ? '?' : key).trim() || '?';
    const words = s.split(/\s+/).filter(Boolean);
    const initials =
      (words.length >= 2
        ? (words[0][0] || '') + (words[1][0] || '')
        : s.replace(/\s+/g, '').slice(0, 2)
      ).toUpperCase() || '?';
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return { initials, bg: `hsl(${hue} 58% 45%)` };
  }

  /** Avatar as a ready-to-inject HTML string. */
  function uiAvatarHtml(key, cls = '') {
    const a = uiAvatar(key);
    return `<span class="avatar ${cls}" style="background:${a.bg}" aria-hidden="true">${escapeHtml(a.initials)}</span>`;
  }

  /** Status pill HTML string. tone: green|amber|red|blue|gray */
  function uiPill(text, tone = 'gray') {
    return `<span class="badge badge-${tone}">${escapeHtml(String(text))}</span>`;
  }

  window.ui = {
    confirm: uiConfirm,
    alert: uiAlert,
    alertPre: uiAlertPre,
    toast: uiToast,
    loading: uiLoading,
    avatar: uiAvatar,
    avatarHtml: uiAvatarHtml,
    pill: uiPill,
    escapeHtml,
  };
})();

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

  /**
   * Prev / "Halaman X / Y" / Next control. Returns an HTMLElement (or null when
   * there's only one page). onChange(nextPage) fires on a click; the caller
   * re-renders. Buttons are real <button>s, disabled (not hidden) at the bounds.
   */
  function uiPager({ page, pageCount, onChange }) {
    if (!pageCount || pageCount <= 1) return null;
    const label = window.i18n ? window.i18n.t('common.pageOf', { page, total: pageCount }) : `${page} / ${pageCount}`;
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center justify-center gap-3 mt-4';
    wrap.innerHTML = `
      <button type="button" class="btn btn-sm btn-ghost" data-dir="-1" ${page <= 1 ? 'disabled' : ''}
        aria-label="${window.i18n ? window.i18n.t('common.prevPage') : 'Previous page'}">&#8592;</button>
      <span class="meta-faint text-sm" aria-live="polite">${escapeHtml(label)}</span>
      <button type="button" class="btn btn-sm btn-ghost" data-dir="1" ${page >= pageCount ? 'disabled' : ''}
        aria-label="${window.i18n ? window.i18n.t('common.nextPage') : 'Next page'}">&#8594;</button>`;
    wrap.querySelectorAll('button[data-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        const next = page + Number(b.dataset.dir);
        if (next >= 1 && next <= pageCount) onChange(next);
      });
    });
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Password show/hide toggle
  // ---------------------------------------------------------------------------
  const EYE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  const pwLabel = (isHidden) => {
    const key = isHidden ? 'common.showPassword' : 'common.hidePassword';
    return window.i18n ? window.i18n.t(key) : isHidden ? 'Show password' : 'Hide password';
  };

  /** Wrap every <input type="password"> under `root` with an eye toggle button. Idempotent. */
  function enhancePasswordFields(root = document) {
    root.querySelectorAll('input[type="password"]:not([data-pw-enhanced])').forEach((input) => {
      input.dataset.pwEnhanced = '1';
      const wrap = document.createElement('div');
      wrap.className = 'pw-field';
      // move margin utilities off the input so the wrapper keeps the same layout
      Array.from(input.classList).forEach((c) => {
        if (/^m[btxy]?-/.test(c)) {
          input.classList.remove(c);
          wrap.classList.add(c);
        }
      });
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-toggle';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', pwLabel(true));
      btn.innerHTML = EYE;
      btn.addEventListener('click', () => {
        const nowText = input.type === 'password';
        input.type = nowText ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(nowText));
        btn.innerHTML = nowText ? EYE_OFF : EYE;
        btn.setAttribute('aria-label', pwLabel(!nowText));
        input.focus();
      });
      wrap.appendChild(btn);
    });
  }

  window.addEventListener('i18n:changed', () => {
    document.querySelectorAll('.pw-toggle').forEach((b) => {
      b.setAttribute('aria-label', pwLabel(b.getAttribute('aria-pressed') !== 'true'));
    });
  });

  // ---------------------------------------------------------------------------
  // Custom <select> -> ARIA listbox. Desktop/mouse only; on touch the native
  // <select> is left alone (its OS picker beats anything we'd build). The native
  // element stays in the DOM as the value source of truth — every existing
  // getElementById(id).value / .value = / 'change' / .innerHTML consumer keeps
  // working unchanged; we just write back to it and dispatch 'change'.
  // ---------------------------------------------------------------------------
  const DESKTOP = window.matchMedia('(hover: hover) and (pointer: fine)');
  const selects = new Set();
  let typeBuf = '';
  let typeBufAt = 0;

  const CHEVRON =
    '<svg class="ui-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  function labelIdFor(native) {
    if (!native.id) return null;
    const lbl = document.querySelector(`label[for="${(window.CSS && CSS.escape ? CSS.escape(native.id) : native.id)}"]`);
    if (!lbl) return null;
    if (!lbl.id) lbl.id = native.id + '-label';
    return lbl.id;
  }

  function buildOptions(ctx) {
    ctx.panel.innerHTML = Array.from(ctx.native.options)
      .map((o, i) => {
        const id = (ctx.native.id || 'uisel') + '-opt-' + i;
        return `<div class="ui-select__option" role="option" id="${id}" data-index="${i}" aria-selected="false">${escapeHtml(o.textContent)}</div>`;
      })
      .join('');
  }

  function syncFromNative(ctx) {
    const i = ctx.native.selectedIndex;
    const opt = ctx.native.options[i];
    ctx.trigger.querySelector('.ui-select__value').textContent = opt ? opt.textContent : '';
    ctx.panel.querySelectorAll('[role="option"]').forEach((el, idx) => {
      el.setAttribute('aria-selected', String(idx === i));
      el.classList.toggle('is-active', idx === i);
    });
    ctx.activeIndex = i;
  }

  function mirrorState(ctx) {
    ctx.wrap.classList.toggle('hidden', ctx.native.classList.contains('hidden'));
    ctx.wrap.classList.toggle('is-disabled', ctx.native.disabled);
    ctx.trigger.disabled = ctx.native.disabled;
  }

  function setActive(ctx, idx) {
    const els = ctx.panel.querySelectorAll('[role="option"]');
    if (!els.length) return;
    idx = Math.max(0, Math.min(els.length - 1, idx));
    els.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    ctx.activeIndex = idx;
    ctx.panel.setAttribute('aria-activedescendant', els[idx].id);
    els[idx].scrollIntoView({ block: 'nearest' });
  }

  function positionPanel(ctx) {
    const r = ctx.trigger.getBoundingClientRect();
    const p = ctx.panel;
    p.style.left = r.left + 'px';
    p.style.minWidth = r.width + 'px';
    const below = window.innerHeight - r.bottom;
    const above = below < 260 && r.top > below;
    p.classList.toggle('ui-select__panel--above', above);
    if (above) {
      p.style.top = 'auto';
      p.style.bottom = window.innerHeight - r.top + 4 + 'px';
    } else {
      p.style.bottom = 'auto';
      p.style.top = r.bottom + 4 + 'px';
    }
  }

  function openPanel(ctx) {
    if (ctx.native.disabled || ctx.open) return;
    selects.forEach((c) => c !== ctx && c.open && closePanel(c, false));
    ctx.open = true;
    ctx.panel.hidden = false;
    positionPanel(ctx);
    ctx.trigger.setAttribute('aria-expanded', 'true');
    setActive(ctx, ctx.native.selectedIndex < 0 ? 0 : ctx.native.selectedIndex);
    ctx.panel.focus();
    requestAnimationFrame(() => ctx.panel.classList.add('is-open'));
    ctx._dismiss = (e) => {
      if (e.type === 'pointerdown' && ctx.wrap.contains(e.target)) return;
      closePanel(ctx, e.type !== 'pointerdown');
    };
    document.addEventListener('pointerdown', ctx._dismiss, true);
    window.addEventListener('scroll', ctx._dismiss, true);
    window.addEventListener('resize', ctx._dismiss, true);
  }

  function closePanel(ctx, focusTrigger = true) {
    if (!ctx.open) return;
    ctx.open = false;
    ctx.panel.classList.remove('is-open');
    ctx.panel.hidden = true;
    ctx.panel.removeAttribute('aria-activedescendant');
    ctx.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', ctx._dismiss, true);
    window.removeEventListener('scroll', ctx._dismiss, true);
    window.removeEventListener('resize', ctx._dismiss, true);
    if (focusTrigger) ctx.trigger.focus();
  }

  function commit(ctx, idx) {
    const opt = ctx.native.options[idx];
    if (opt && ctx.native.value !== opt.value) {
      ctx.native.value = opt.value;
      ctx.native.dispatchEvent(new Event('input', { bubbles: true }));
      ctx.native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    syncFromNative(ctx);
    closePanel(ctx);
  }

  function typeahead(ctx, ch, commitNow) {
    const now = Date.now();
    typeBuf = now - typeBufAt > 500 ? ch : typeBuf + ch;
    typeBufAt = now;
    const match = Array.from(ctx.native.options).findIndex((o) =>
      o.textContent.trim().toLowerCase().startsWith(typeBuf.toLowerCase())
    );
    if (match < 0) return;
    commitNow ? commit(ctx, match) : setActive(ctx, match);
  }

  function onTriggerKey(ctx, e) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openPanel(ctx);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      typeahead(ctx, e.key, true);
    }
  }

  function onPanelKey(ctx, e) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(ctx, ctx.activeIndex + 1); break;
      case 'ArrowUp': e.preventDefault(); setActive(ctx, ctx.activeIndex - 1); break;
      case 'Home': e.preventDefault(); setActive(ctx, 0); break;
      case 'End': e.preventDefault(); setActive(ctx, ctx.native.options.length - 1); break;
      case 'Enter':
      case ' ': e.preventDefault(); commit(ctx, ctx.activeIndex); break;
      case 'Escape': e.preventDefault(); closePanel(ctx); break;
      case 'Tab': commit(ctx, ctx.activeIndex); break; // commit() closes + focuses the trigger; default Tab then advances
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) { e.preventDefault(); typeahead(ctx, e.key, false); }
    }
  }

  function enhanceSelect(native) {
    if (!DESKTOP.matches || native.dataset.uiEnhanced || native.hasAttribute('data-no-enhance')) return;
    native.dataset.uiEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'ui-select';
    if (native.id) wrap.classList.add('ui-select--' + native.id);
    // carry sizing / layout utilities from the native onto the wrapper
    Array.from(native.classList).forEach((c) => {
      if (c !== 'field' && c !== 'swal2-select') wrap.classList.add(c);
    });
    native.parentNode.insertBefore(wrap, native);
    wrap.appendChild(native);
    native.classList.add('ui-select__native');
    native.setAttribute('tabindex', '-1');
    native.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ui-select__trigger field';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const lid = labelIdFor(native);
    if (lid) trigger.setAttribute('aria-labelledby', lid);
    else if (native.getAttribute('aria-label')) trigger.setAttribute('aria-label', native.getAttribute('aria-label'));
    trigger.innerHTML = `<span class="ui-select__value"></span>${CHEVRON}`;

    const panel = document.createElement('div');
    panel.className = 'ui-select__panel';
    panel.setAttribute('role', 'listbox');
    panel.tabIndex = -1;
    panel.hidden = true;
    if (lid) panel.setAttribute('aria-labelledby', lid);

    wrap.append(trigger, panel);
    const ctx = { native, wrap, trigger, panel, open: false, activeIndex: -1 };

    buildOptions(ctx);
    syncFromNative(ctx);
    mirrorState(ctx);

    trigger.addEventListener('click', () => (ctx.open ? closePanel(ctx) : openPanel(ctx)));
    trigger.addEventListener('keydown', (e) => onTriggerKey(ctx, e));
    panel.addEventListener('keydown', (e) => onPanelKey(ctx, e));
    panel.addEventListener('click', (e) => {
      const opt = e.target.closest('[role="option"]');
      if (opt) commit(ctx, Number(opt.dataset.index));
    });

    new MutationObserver(() => {
      buildOptions(ctx);
      syncFromNative(ctx);
      mirrorState(ctx);
    }).observe(native, { childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });

    selects.add(ctx);
  }

  /** Enhance every not-yet-enhanced <select> under `root` (no-op on touch devices). */
  function enhanceAllSelects(root = document) {
    if (!DESKTOP.matches) return;
    root.querySelectorAll('select:not([data-ui-enhanced]):not([data-no-enhance])').forEach(enhanceSelect);
  }

  window.addEventListener('i18n:changed', () => {
    selects.forEach((ctx) => {
      buildOptions(ctx);
      syncFromNative(ctx);
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    enhancePasswordFields();
    enhanceAllSelects();
  });

  /**
   * Log the user out after 10 min with no mouse/keyboard/scroll activity, with
   * a warning modal 1 min before. `onIdle` should reuse the page's existing
   * logout path. `isSuspended()` (optional) freezes the countdown without
   * unbinding — used to keep a student from being logged out mid-exam.
   */
  function idleLogout({ onIdle, isSuspended = () => false }) {
    const IDLE_MS = 10 * 60 * 1000;
    const WARN_MS = 60 * 1000;
    let warnTimer;
    let idleTimer;
    let lastKick = 0;
    let warning = false;

    function arm() {
      clearTimeout(warnTimer);
      clearTimeout(idleTimer);
      warnTimer = setTimeout(showWarning, IDLE_MS - WARN_MS);
      idleTimer = setTimeout(() => (isSuspended() ? arm() : onIdle()), IDLE_MS);
    }

    function kick() {
      if (warning) return; // the modal owns the decision now
      if (isSuspended()) return arm(); // keep the timer fresh so it never lapses mid-exam
      const now = Date.now();
      if (now - lastKick < 1000) return; // throttle
      lastKick = now;
      arm();
    }

    async function showWarning() {
      if (isSuspended()) return arm();
      warning = true;
      const stay = await uiConfirm(
        window.i18n ? window.i18n.t('common.idleWarnText') : 'You will be logged out in 1 minute.',
        {
          icon: 'warning',
          title: window.i18n ? window.i18n.t('common.idleWarnTitle') : 'Still there?',
          confirmText: window.i18n ? window.i18n.t('common.idleStayBtn') : "I'm still here",
          cancelText: window.i18n ? window.i18n.t('common.logout') : 'Log out',
        }
      );
      warning = false;
      if (stay) arm();
      else onIdle();
    }

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach((e) =>
      document.addEventListener(e, kick, { passive: true })
    );
    arm();
  }

  window.ui = {
    confirm: uiConfirm,
    idleLogout,
    alert: uiAlert,
    alertPre: uiAlertPre,
    toast: uiToast,
    loading: uiLoading,
    avatar: uiAvatar,
    avatarHtml: uiAvatarHtml,
    pill: uiPill,
    pager: uiPager,
    escapeHtml,
    enhancePasswordFields,
    enhanceSelect,
    enhanceAllSelects,
  };
})();

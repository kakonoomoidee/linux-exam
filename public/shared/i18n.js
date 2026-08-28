/**
 * Tiny no-dependency i18n for the (build-step-free) frontend.
 *
 * Strings live in server/locales/{id,en}.json and are injected into the page
 * as window.__I18N__ by the EJS head (see the student and admin index views).
 * Edit the JSON files to change copy — no build step, just restart the server.
 *
 * Usage:
 *   - static markup:  <span data-i18n="key">           text swapped
 *                     <input data-i18n-ph="key">        placeholder swapped
 *                     <title data-i18n="key">           title swapped
 *   - from JS:        i18n.t('key', { var: 1 })         "{var}" interpolated
 *   - server errors:  i18n.apiError(msg)                translates a known ID string
 *
 * Language: localStorage 'tekser_lang', else browser language, else 'en'.
 * A <select id="lang-switcher"> anywhere on the page is auto-wired.
 * Dynamic (JS-rendered) content should re-render on the 'i18n:changed' event.
 */
(function () {
  const DICT = window.__I18N__ || { id: {}, en: {} };

  const SUPPORTED = ['id', 'en'];
  let lang = localStorage.getItem('tekser_lang');
  if (!SUPPORTED.includes(lang)) {
    lang = (navigator.language || 'en').toLowerCase().startsWith('id') ? 'id' : 'en';
  }

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), () => String(vars[k]));
      }
    }
    return s;
  }

  function applyStatic(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    document.documentElement.lang = lang;
  }

  function setLang(next) {
    if (!SUPPORTED.includes(next) || next === lang) return;
    lang = next;
    localStorage.setItem('tekser_lang', next);
    applyStatic();
    window.dispatchEvent(new Event('i18n:changed'));
  }

  // Server error strings are keyed by their Indonesian source text (see the
  // bottom of en.json). In Indonesian the source text is already correct.
  function apiError(msg) {
    if (!msg || lang === 'id') return msg;
    return (DICT.en && DICT.en[msg]) || msg;
  }

  window.i18n = { t, applyStatic, setLang, apiError, getLang: () => lang };

  document.addEventListener('DOMContentLoaded', () => {
    applyStatic();
    const sw = document.getElementById('lang-switcher');
    if (sw) {
      sw.value = lang;
      sw.addEventListener('change', () => setLang(sw.value));
    }
  });
})();

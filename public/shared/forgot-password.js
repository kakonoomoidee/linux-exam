// Shared "Lupa Password?" flow: NIM -> Telegram OTP -> new password.
// Extracted from student/js/app.js so /admin reuses it verbatim. The markup lives
// in server/views/partials/forgot-password-screen.ejs and uses the same element
// IDs on both pages (they are separate documents, so no collision).
// ponytail: i18n keys keep their `student.` prefix — they resolve on /admin too
// since the full locale dict loads there; renaming ~10 keys is pure churn.
(function () {
  const API = '/api';
  const t = (k, v) => window.i18n.t(k, v);
  const $ = (id) => document.getElementById(id);

  let cfg = { onExit: () => {}, nimSourceId: null };

  function setStep(n) {
    $('forgot-pw-step-indicator').textContent = t('student.stepIndicator', { n, total: 2 });
  }

  // Show step 1 fresh and swap the login screen for the forgot-password screen.
  function open() {
    ['forgot-nim-input', 'forgot-otp-input', 'forgot-new-pw-input', 'forgot-confirm-pw-input'].forEach((id) => {
      $(id).value = '';
    });
    $('forgot-otp-error').textContent = '';
    $('forgot-pw-generic-msg').textContent = '';
    $('forgot-pw-step1').classList.remove('hidden');
    $('forgot-pw-step2').classList.add('hidden');
    setStep(1);
    const src = cfg.nimSourceId && $(cfg.nimSourceId);
    if (src && src.value.trim()) $('forgot-nim-input').value = src.value.trim();
    $('login-screen').classList.add('hidden');
    $('forgot-password-screen').classList.remove('hidden');
    $('forgot-nim-input').focus();
  }

  function goToOtpStep() {
    $('forgot-pw-generic-msg').textContent = t('student.forgotPwGeneric');
    $('forgot-pw-step1').classList.add('hidden');
    $('forgot-pw-step2').classList.remove('hidden');
    setStep(2);
    $('forgot-otp-input').focus();
  }

  async function request() {
    const nim = $('forgot-nim-input').value.trim();
    if (!nim) return;
    const btn = $('forgot-pw-send-btn');
    btn.disabled = true;
    try {
      // Response is intentionally generic (and constant-time) — advance regardless.
      await fetch(`${API}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nim }),
      });
    } catch {
      /* still advance — nothing here reveals whether the NIM exists */
    } finally {
      btn.disabled = false;
    }
    goToOtpStep();
  }

  async function reset() {
    const nim = $('forgot-nim-input').value.trim();
    const otp = $('forgot-otp-input').value.trim();
    const newPassword = $('forgot-new-pw-input').value;
    const confirm = $('forgot-confirm-pw-input').value;
    const errEl = $('forgot-otp-error');
    errEl.textContent = '';
    if (!otp || !newPassword) return;
    if (newPassword !== confirm) {
      errEl.textContent = t('student.pwMismatch');
      return;
    }
    const btn = $('forgot-pw-reset-btn');
    btn.disabled = true;
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nim, otp, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = window.i18n.apiError(data.error) || t('student.forgotPwResetFailed');
        return;
      }
      cfg.onExit();
      window.ui.toast(data.message || t('student.forgotPwResetOk'));
    } catch {
      errEl.textContent = t('common.requestFailed', { status: 0 });
    } finally {
      btn.disabled = false;
    }
  }

  // onExit: caller returns its own login screen to view (and clears its error line).
  // nimSourceId: optional login NIM input to prefill from.
  function init({ onExit, nimSourceId } = {}) {
    cfg = { onExit: onExit || (() => {}), nimSourceId: nimSourceId || null };
    $('forgot-pw-send-btn').addEventListener('click', request);
    $('forgot-pw-reset-btn').addEventListener('click', reset);
    $('forgot-pw-back-btn').addEventListener('click', () => cfg.onExit());
    $('forgot-nim-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') request();
    });
  }

  window.forgotPassword = { init, open };
})();

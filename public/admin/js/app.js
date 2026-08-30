// API, t, adminToken, readRole, apiFetch live in api.js (loaded before this file).

/** Show/hide instruktur-only controls (sidebar links + [data-role="instruktur-visible"]). */
function applyRoleVisibility() {
  const isInstruktur = window.adminRole === 'instruktur';
  document.querySelectorAll('[data-role="instruktur-visible"]').forEach((el) => {
    el.hidden = !isInstruktur;
  });
}

document.getElementById('admin-login-btn').addEventListener('click', async () => {
  const nim = document.getElementById('admin-nim').value.trim();
  const password = document.getElementById('admin-password').value;
  const errorEl = document.getElementById('admin-login-error');
  try {
    const res = await fetch(`${API}/auth/login/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nim, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(window.i18n.apiError(data.error));
    adminToken = data.token;
    localStorage.setItem('tekser_admin_token', adminToken);
    window.adminRole = (data.user && data.user.role) || readRole(adminToken);
    boot();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('admin-logout-btn').addEventListener('click', () => {
  localStorage.removeItem('tekser_admin_token');
  location.reload();
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'review') window.loadReviewSessionOptions?.();
    if (btn.dataset.tab === 'grades') window.loadGradesSessionOptions?.();
    if (btn.dataset.tab === 'students') window.loadStudents?.();
    if (btn.dataset.tab === 'questions') window.loadQuestionBank?.();
    if (btn.dataset.tab === 'staff') window.loadStaff?.();
  });
});
function boot() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  applyRoleVisibility();
  window.connectAdminSocket?.();
  window.loadSessions?.();
  // deep link: /admin#questions etc. (used by the sidebar on the standalone
  // session page) — open that tab instead of the default "Sesi".
  const target = document.querySelector(`.tab-btn[data-tab="${location.hash.slice(1)}"]`);
  if (target) target.click();
}

// wait for the sibling scripts (sessions.js etc.) to register their globals
if (adminToken) document.addEventListener('DOMContentLoaded', boot);

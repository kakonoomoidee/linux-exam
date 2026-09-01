// API, t, adminToken, readRole, apiFetch live in api.js (loaded before this file).

/** Instruktur-only controls (sidebar links, create/delete buttons) are hidden by
 *  theme.css until <html> has .is-instruktur. An inline <head> script sets it
 *  pre-paint from the stored token; this re-syncs it after a fresh login. */
function applyRoleVisibility() {
  document.documentElement.classList.toggle('is-instruktur', window.adminRole === 'instruktur');
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

function logout() {
  localStorage.removeItem('tekser_admin_token');
  location.reload();
}
document.getElementById('admin-logout-btn').addEventListener('click', logout);

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
    if (btn.dataset.tab === 'audit') window.loadAudit?.();
  });
});
function boot() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  applyRoleVisibility();
  window.ui.idleLogout({ onIdle: logout });
  window.connectAdminSocket?.();
  window.loadSessions?.();
  // deep link: /admin#questions etc. (used by the sidebar on the standalone
  // session page) — open that tab instead of the default "Sesi".
  const target = document.querySelector(`.tab-btn[data-tab="${location.hash.slice(1)}"]`);
  if (target) target.click();
}

// wait for the sibling scripts (sessions.js etc.) to register their globals
if (adminToken) document.addEventListener('DOMContentLoaded', boot);

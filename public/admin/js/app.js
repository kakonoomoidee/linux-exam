const API = '/api';
const t = (k, v) => window.i18n.t(k, v);
let adminToken = localStorage.getItem('tekser_admin_token') || null;

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${adminToken}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(window.i18n.apiError(data.error) || t('common.requestFailed', { status: res.status }));
  return data;
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
    boot();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'review') window.loadReviewSessionOptions?.();
  });
});
function boot() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard-screen').classList.remove('hidden');
  window.connectAdminSocket?.();
  window.loadSessions?.();
}

// wait for the sibling scripts (sessions.js etc.) to register their globals
if (adminToken) document.addEventListener('DOMContentLoaded', boot);

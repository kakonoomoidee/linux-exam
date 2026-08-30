// Shared admin API bootstrap. Loaded first on every admin page (the dashboard
// and the standalone /admin/sessions/* pages) so its globals — API, t,
// adminToken, apiFetch — are defined before any page script runs. These are
// declared here and NOWHERE else; re-declaring them would be a SyntaxError that
// kills all admin JS on the page.
const API = '/api';
const t = (k, v) => window.i18n.t(k, v);
let adminToken = localStorage.getItem('tekser_admin_token') || null;

// Role rides in the JWT payload — decode it (no verification needed client-side,
// the server enforces; this is only to hide buttons that would 403 anyway).
function readRole(token) {
  try {
    return JSON.parse(atob((token || '').split('.')[1] || '')).role || null;
  } catch {
    return null;
  }
}
window.adminRole = readRole(adminToken);

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

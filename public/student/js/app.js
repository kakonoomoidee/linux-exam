const API = '/api';
const t = (k, v) => window.i18n.t(k, v);
let token = localStorage.getItem('tekser_token') || null;
let socket = null;
let term = null;
let timerInterval = null;
let lastExamData = null; // kept so the question panel can re-render on language change
let examLocked = false;   // anti-cheat: true while the tab-switch lockdown overlay is up
let pendingExamData = null; // container is ready; held until the student clicks "Mulai"
let joinPollTimer = null;   // re-polls /me/join while the session is still 'pending'
let pwChangeVoluntary = false; // true when the student opened change-password from the dashboard (not forced)

const screens = {
  login: document.getElementById('login-screen'),
  changePassword: document.getElementById('change-password-screen'),
  forgotPassword: document.getElementById('forgot-password-screen'),
  dashboard: document.getElementById('dashboard-screen'),
  waiting: document.getElementById('waiting-screen'),
  exam: document.getElementById('exam-screen'),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('nim-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('password-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('submit-btn').addEventListener('click', submitExam);
document.getElementById('change-pw-btn').addEventListener('click', submitPasswordChange);
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('change-pw-link').addEventListener('click', () => showChangePassword(true));
document.getElementById('change-pw-back-btn').addEventListener('click', enterDashboard);
// Idle auto-logout everywhere EXCEPT the active exam screen — sitting and
// thinking is normal mid-exam, and the server-side clock runs regardless.
window.ui.idleLogout({
  onIdle: logout,
  isSuspended: () => !screens.exam.classList.contains('hidden'),
});
document.getElementById('join-btn').addEventListener('click', joinSession);
document.getElementById('waiting-back-btn').addEventListener('click', enterDashboard);
document.getElementById('waiting-pending-back-btn').addEventListener('click', enterDashboard);
document.getElementById('start-exam-now-btn').addEventListener('click', () => {
  if (pendingExamData) startExamUi(pendingExamData);
});
document.getElementById('join-code-input').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
document.getElementById('join-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinSession();
});

// forgot-password flow
document.getElementById('forgot-pw-link').addEventListener('click', showForgotPassword);
document.getElementById('forgot-pw-back-btn').addEventListener('click', () => showScreen('login'));
document.getElementById('forgot-pw-send-btn').addEventListener('click', forgotPasswordRequest);
document.getElementById('forgot-pw-reset-btn').addEventListener('click', forgotPasswordReset);
document.getElementById('forgot-nim-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') forgotPasswordRequest();
});

// telegram binding (dashboard card)
document.getElementById('telegram-connect-btn').addEventListener('click', connectTelegram);
document.getElementById('telegram-disconnect-btn').addEventListener('click', disconnectTelegram);

/** Persist identity + the must-change flag together so a refresh knows where to land. */
function persistUser(user, mustChangePassword) {
  localStorage.setItem('tekser_user', JSON.stringify({ ...(user || {}), mustChangePassword: !!mustChangePassword }));
}
function storedUser() {
  try {
    return JSON.parse(localStorage.getItem('tekser_user') || '{}');
  } catch {
    return {};
  }
}

async function login() {
  const nim = document.getElementById('nim-input').value.trim();
  const password = document.getElementById('password-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!nim || !password) return;

  try {
    const res = await fetch(`${API}/auth/login/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nim, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    localStorage.setItem('tekser_token', token);
    persistUser(data.user, data.mustChangePassword);
    setIdentity(data.user);
    if (data.mustChangePassword) showChangePassword(false);
    else enterDashboard();
  } catch (err) {
    errorEl.textContent = window.i18n.apiError(err.message) || t('student.loginFailed');
  }
}

async function submitPasswordChange() {
  const currentPassword = document.getElementById('current-pw-input').value;
  const newPassword = document.getElementById('new-pw-input').value;
  const confirm = document.getElementById('confirm-pw-input').value;
  const errorEl = document.getElementById('change-pw-error');
  errorEl.textContent = '';
  if (!currentPassword || !newPassword) return;
  if (newPassword !== confirm) {
    errorEl.textContent = t('student.pwMismatch');
    return;
  }

  try {
    const res = await fetch(`${API}/me/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token; // fresh token, no longer must-change
    localStorage.setItem('tekser_token', token);
    persistUser(storedUser(), false);
    const wasVoluntary = pwChangeVoluntary;
    enterDashboard();
    if (wasVoluntary) window.ui.toast(t('student.changePwDone'));
  } catch (err) {
    errorEl.textContent = window.i18n.apiError(err.message) || t('common.requestFailed', { status: 0 });
  }
}

/**
 * Show the change-password screen. `voluntary` = opened from the dashboard sidebar
 * (offer a way back, neutral copy); otherwise it's the forced first-login gate.
 */
function showChangePassword(voluntary) {
  pwChangeVoluntary = !!voluntary;
  const subtitle = document.getElementById('change-pw-subtitle');
  subtitle.setAttribute(
    'data-i18n',
    voluntary ? 'student.changePwVoluntarySubtitle' : 'student.changePwSubtitle'
  );
  subtitle.textContent = t(subtitle.getAttribute('data-i18n'));
  document.getElementById('change-pw-back-btn').classList.toggle('hidden', !voluntary);
  ['current-pw-input', 'new-pw-input', 'confirm-pw-input'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('change-pw-error').textContent = '';
  showScreen('changePassword');
}

function enterDashboard() {
  clearTimeout(joinPollTimer);
  const user = storedUser();
  showScreen('dashboard');
  document.getElementById('dash-name').textContent = user.name || user.nim || '';
  document.getElementById('dash-nim').textContent = user.nim || '';
  const kelasEl = document.getElementById('dash-kelas');
  kelasEl.textContent = user.kelas ? ` · ${user.kelas}` : '';
  const av = document.getElementById('dash-avatar');
  if (av && window.ui) {
    const a = window.ui.avatar(user.name || user.nim || '?');
    av.textContent = a.initials;
    av.style.background = a.bg;
  }
  loadHistory();
  loadTelegramStatus();
}

async function loadHistory() {
  const list = document.getElementById('history-list');
  // skeleton so the card never flashes empty before the fetch resolves
  list.innerHTML = '<div class="row-list">' + '<div class="skeleton skeleton-row"></div>'.repeat(3) + '</div>';
  try {
    const res = await fetch(`${API}/me/history`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error();
    const rows = await res.json();
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <div class="empty-state__title">${t('student.historyEmpty')}</div>
        <div class="empty-state__hint">${t('student.historyEmptyHint')}</div>
      </div>`;
      return;
    }
    list.innerHTML =
      '<div class="row-list">' +
      rows
        .map((r) => {
          const when = r.started_at || r.created_at;
          const date = when ? new Date(when).toLocaleDateString() : '';
          return `<div class="card-row">
            <div class="card-row__identity">
              <div class="card-row__name">${window.ui.escapeHtml(r.session_name || '')}</div>
              <div class="card-row__meta">${window.ui.escapeHtml(date)}</div>
            </div>
            <div class="card-row__aside">
              <span class="badge badge-plain" style="font-weight:700">${t('student.historyScore', { score: Number(r.score) })}</span>
            </div>
          </div>`;
        })
        .join('') +
      '</div>';
  } catch {
    list.innerHTML = `<p class="text-sm text-[color:var(--danger)]">${t('common.requestFailed', { status: 0 })}</p>`;
  }
}

async function joinSession() {
  const input = document.getElementById('join-code-input');
  const code = input.value.trim().toUpperCase();
  document.getElementById('join-error').textContent = '';
  if (!code) return;
  attemptJoin(code, false);
}

/**
 * POST /me/join and route on the response taxonomy. Also used to re-poll while
 * the session is still 'pending' (instructor hasn't clicked "Mulai Ujian") —
 * `fromPoll` keeps a transient failure quiet and reports an ended session by
 * bouncing back to the dashboard instead of writing under the code input.
 */
function scheduleJoinPoll(code) {
  clearTimeout(joinPollTimer);
  joinPollTimer = setTimeout(() => {
    if (!screens.waiting.classList.contains('hidden')) attemptJoin(code, true);
  }, 4000);
}

async function attemptJoin(code, fromPoll) {
  const errorEl = document.getElementById('join-error');
  let res;
  try {
    res = await fetch(`${API}/me/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });
  } catch {
    // transient network blip mid-wait — keep the waiting screen and keep polling
    if (fromPoll) return scheduleJoinPoll(code);
    errorEl.textContent = t('student.joinFailed');
    return;
  }
  const data = await res.json().catch(() => ({}));

  // Case 3: on the roster, right code, but the session hasn't started. Wait
  // here and re-poll — no need to re-enter the code.
  if (res.status === 202 && data.status === 'pending') {
    showWaitingPending();
    scheduleJoinPoll(code);
    return;
  }

  clearTimeout(joinPollTimer);

  if (!res.ok) {
    // 5xx mid-poll is transient (server restart / brief blip) — keep polling,
    // don't mistake it for the exam being over.
    if (fromPoll && res.status >= 500) return scheduleJoinPoll(code);
    // wrong code / not on roster / exam over
    const msg = window.i18n.apiError(data.error) || t('student.joinFailed');
    if (fromPoll) {
      enterDashboard(); // session went pending -> ended while we were waiting
    }
    errorEl.textContent = msg;
    return;
  }

  // Case 4: running + claimed — provisioning is underway.
  showWaiting();
  checkActiveParticipant();
}

// The waiting screen has four mutually-exclusive inner blocks; each helper
// shows one and hides the rest.
function waitingBlock(id) {
  ['waiting-spinner', 'waiting-error', 'waiting-ready', 'waiting-pending'].forEach((b) =>
    document.getElementById(b).classList.toggle('hidden', b !== id)
  );
}

/** Waiting screen in its default (spinner) state — container provisioning. */
function showWaiting() {
  showScreen('waiting');
  screens.waiting.setAttribute('aria-busy', 'true');
  waitingBlock('waiting-spinner');
}

/** Session exists and the student is on the roster, but "Mulai Ujian" not clicked yet. */
function showWaitingPending() {
  showScreen('waiting');
  screens.waiting.setAttribute('aria-busy', 'true');
  waitingBlock('waiting-pending');
}

/** Provisioning failed server-side — show it, don't leave the student on a dead spinner. */
function showProvisionError() {
  showScreen('waiting');
  screens.waiting.removeAttribute('aria-busy');
  waitingBlock('waiting-error');
}

/**
 * Container is ready. The exam clock is already running session-wide, so this
 * is a pure UI-reveal gate — the student clicks "Mulai" to drop into the
 * terminal. Shown on every load (incl. a mid-exam refresh) by design.
 */
function showWaitingReady() {
  showScreen('waiting');
  screens.waiting.removeAttribute('aria-busy');
  waitingBlock('waiting-ready');
}

// Wipe the stored session and reload to a clean login screen. Used both by the
// logout button and whenever the server rejects our token (401): reloading
// drops the stale `token` var, any queued polling timers and a half-started
// exam UI. After the reload `token` is null so resume() doesn't re-fire.
function resetToLogin() {
  localStorage.removeItem('tekser_token');
  localStorage.removeItem('tekser_user');
  location.reload();
}
function logout() {
  resetToLogin();
}

async function checkActiveParticipant() {
  const res = await fetch(`${API}/me/active-participant`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return resetToLogin(); // token rejected mid-poll — force a clean re-login
  if (res.status === 403) {
    // token still says "must change password"
    showChangePassword(false);
    return;
  }
  if (res.status === 404) {
    // container still provisioning — keep polling while on the waiting screen
    if (!screens.waiting.classList.contains('hidden')) setTimeout(checkActiveParticipant, 5000);
    return;
  }
  const data = await res.json();
  if (data.participant && data.participant.container_status === 'error') {
    // a stale poll shouldn't yank a student who already navigated back to the dashboard
    if (!screens.waiting.classList.contains('hidden')) showProvisionError();
    return;
  }
  pendingExamData = data;
  showWaitingReady();
}

// each step is isolated: if the terminal can't init or the socket can't
// connect (e.g. a vendored lib failed to load, or the container isn't up),
// the questions and the countdown must still work.
function startExamUi(data) {
  lastExamData = data;
  showScreen('exam');
  document.getElementById('submit-btn').disabled = false; // clear a leftover disable from a prior submit

  const step = (name, fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`[startExamUi] ${name} failed`, err);
    }
  };

  step('renderQuestions', () => renderQuestions(data.questions, data.submissions));
  step('initTerminal', initTerminal);
  if (!term) term = { write() {}, writeln() {}, onData() {}, dispose() {} }; // stub so connectSocket never throws
  step('connectSocket', () => connectSocket(data.participant.session_token));
  step('startTimer', () => startTimer(data.remainingMs));
}

/** Populate the exam-header identity (name + kelas + avatar). */
function setIdentity(user) {
  user = user || {};
  const name = user.name || user.nim || '';
  document.getElementById('student-name').textContent = name;
  const kelasEl = document.getElementById('student-kelas');
  kelasEl.textContent = user.kelas || '';
  kelasEl.hidden = !user.kelas;
  const av = document.getElementById('student-avatar');
  if (av && window.ui) {
    const a = window.ui.avatar(name || '?');
    av.textContent = a.initials;
    av.style.background = a.bg;
  }
}

/** Pick the question text for the current UI language, falling back to Indonesian. */
function pickStory(q) {
  const en = q.story_text_en || q.story_text_id || q.story_text;
  const id = q.story_text_id || q.story_text;
  return window.i18n.getLang() === 'en' ? en || id : id;
}

const LEVEL_TONE = { easy: 'green', medium: 'amber', hard: 'red' };

function renderQuestions(questions, submissions) {
  const solvedIds = new Set(
    submissions.filter((s) => s.auto_result === 'pass').map((s) => s.question_id)
  );
  const panel = document.getElementById('question-panel');
  panel.innerHTML = questions
    .map(
      (q) => `
      <div class="q-card ${solvedIds.has(q.id) ? 'solved' : ''}" id="q-${q.id}">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="badge">${t('common.questionN', { n: q.order_index })}</span>
          <span class="flex items-center gap-1.5">
            ${q.level ? `<span class="badge badge-${LEVEL_TONE[q.level] || 'amber'}">${t('student.level.' + q.level)}</span>` : ''}
            <span class="text-xs text-[color:var(--text-faint)]">${t('common.points', { n: q.point })}</span>
          </span>
        </div>
        <p class="text-sm leading-relaxed text-[color:var(--text-muted)]">${window.ui.escapeHtml(pickStory(q))}</p>
      </div>`
    )
    .join('');
}

function initTerminal() {
  term = new Terminal({ theme: { background: '#000000' }, fontSize: 14 });
  term.open(document.getElementById('terminal'));

  // size the terminal to its pane; degrade to the 80x24 default if the addon is missing
  const fit = window.FitAddon && new FitAddon.FitAddon();
  if (fit) {
    term.loadAddon(fit);
    const doFit = () => { try { fit.fit(); } catch (_) {} };
    requestAnimationFrame(doFit);
    window.addEventListener('resize', doFit);
  }

  term.writeln(t('student.connectingEnv'));
}

function connectSocket(sessionToken) {
  socket = io();
  socket.emit('student:join', { sessionToken });

  socket.on('exam:ready', ({ endsAt } = {}) => {
    term.writeln(t('student.connectedGoodLuck'));
    // the timer's real source of truth: server tells us when the container
    // became ready. Covers the case where the page loaded while provisioning
    // was still running (remainingMs was null then).
    if (endsAt) startTimer(new Date(endsAt).getTime() - Date.now());
  });
  socket.on('exam:error', (e) => term.writeln('\r\n' + t('common.errorPrefix', { msg: window.i18n.apiError(e.message) })));

  socket.on('terminal:output', (data) => term.write(data));
  socket.on('terminal:error', (e) => term.writeln('\r\n' + t('common.errorPrefix', { msg: e.message })));
  term.onData((data) => { if (!examLocked) socket.emit('terminal:input', data); });

  setupLockdown(socket, sessionToken);

  socket.on('exam:score_update', ({ questionId, point, solvedCount, totalQuestions }) => {
    const card = document.getElementById(`q-${questionId}`);
    if (card) card.classList.add('solved');
    showToast(t('student.correctToast', { point, solved: solvedCount, total: totalQuestions }));
  });

  socket.on('exam:ended', ({ submissions }) => {
    clearInterval(timerInterval);
    clearTimeout(window.__submitStallTimer);
    // fires on both manual submit and session-timer expiry — same modal either way.
    showResultsModal(submissions || []);
  });
}

function showToast(text) {
  window.ui.toast(text, 'success');
}

// ---- anti-cheat: lockdown on tab-switch ----
// Detection is best-effort (a browser can't stop OS-level app switching) — this
// is deterrent + audit trail, not an OS lockdown. See README.
function setupLockdown(socket, sessionToken) {
  const overlay = document.getElementById('lock-overlay');
  const codeInput = document.getElementById('lock-code-input');
  const errorEl = document.getElementById('lock-error');

  const examVisible = () => !screens.exam.classList.contains('hidden');

  function lockUi() {
    if (examLocked) return;
    examLocked = true;
    if (term && term.options) term.options.disableStdin = true;
    overlay.classList.remove('hidden');
    errorEl.textContent = '';
    codeInput.value = '';
    codeInput.focus();
  }

  function unlockUi() {
    examLocked = false;
    if (term && term.options) term.options.disableStdin = false;
    overlay.classList.add('hidden');
    errorEl.textContent = '';
    try { term.focus(); } catch (_) {}
  }

  // lock the client FIRST (don't wait for the server round-trip), then report it
  function onStudentLeft() {
    if (examLocked || !examVisible()) return;
    lockUi();
    socket.emit('student:violation', { sessionToken });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onStudentLeft();
  });
  window.addEventListener('blur', onStudentLeft);

  const submitCode = () => {
    const code = codeInput.value.trim();
    if (!code) return;
    errorEl.textContent = '';
    socket.emit('student:unlock', { code });
  };
  document.getElementById('lock-unlock-btn').addEventListener('click', submitCode);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCode(); });

  socket.on('exam:locked', lockUi);
  socket.on('exam:unlocked', () => {
    unlockUi();
    showToast(t('student.unlocked'));
  });
  socket.on('exam:unlock_failed', ({ throttled } = {}) => {
    errorEl.textContent = throttled ? t('student.unlockThrottled') : t('student.unlockWrong');
  });
}

function startTimer(remainingMs) {
  clearInterval(timerInterval); // may be called again from exam:ready
  const timerEl = document.getElementById('timer');
  if (!(remainingMs > 0)) {
    // not provisioned yet — leave "--:--" until exam:ready arrives
    if (remainingMs === 0) timerEl.textContent = '00:00';
    return;
  }
  let remaining = remainingMs;
  const tick = () => {
    const totalSec = Math.max(Math.floor(remaining / 1000), 0);
    const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
    timerEl.classList.toggle('warn', totalSec <= 300 && totalSec > 60);
    timerEl.classList.toggle('low', totalSec <= 60);
    remaining -= 1000;
    if (totalSec <= 0) clearInterval(timerInterval);
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

async function submitExam() {
  const ok = await window.ui.confirm(t('student.submitConfirm'), { icon: 'warning', confirmText: t('student.submitNow') });
  if (!ok) return;

  const closeLoading = window.ui.loading(t('student.submitting'));
  document.getElementById('submit-btn').disabled = true;

  // Safety net: if teardown takes unusually long (or the server never gets
  // to emit exam:ended for some reason), don't leave the student staring at
  // a spinner forever — tell them what's happening after a while.
  const stall = setTimeout(() => {
    closeLoading();
    window.ui.alert(t('student.submitTakingLong'), { icon: 'info' });
  }, 20000);

  try {
    const res = await fetch(`${API}/me/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(window.i18n.apiError(data.error) || t('common.requestFailed', { status: res.status }));
    }
    // server acked the submit; exam:ended over the socket (handled below)
    // is what actually closes the loading modal and switches screens.
  } catch (err) {
    clearTimeout(stall);
    closeLoading();
    document.getElementById('submit-btn').disabled = false;
    window.ui.alert(err.message, { icon: 'error' });
  }

  // exam:ended clears `stall` too (see connectSocket)
  window.__submitStallTimer = stall;
}

/**
 * Exam-over results as a modal over whatever screen the student was on — manual
 * submit OR session-timer expiry. Confirm returns to the dashboard, which
 * re-fetches /me/history so the just-finished exam shows up with no manual refresh.
 * Replaces the old dead-end #ended-screen. `window.ui.modal.fire` also supersedes
 * the still-open "submitting..." loading modal (SweetAlert2 is single-instance).
 */
function showResultsModal(submissions) {
  const total = submissions.reduce((sum, s) => sum + (s.final_score ?? s.auto_score ?? 0), 0);
  const en = window.i18n.getLang() === 'en';
  const rows = submissions
    .map((s) => {
      const solved = s.auto_result === 'pass';
      const story = (en ? s.story_text_en || s.story_text : s.story_text) || '';
      return `<div class="card-row">
        <div class="card-row__identity">
          <div class="card-row__name">${t('common.questionN', { n: s.order_index })}</div>
          <div class="card-row__meta">${window.ui.escapeHtml(story)}</div>
        </div>
        <div class="card-row__aside">
          <span class="badge badge-${solved ? 'green' : 'red'}">${solved ? '✅' : '❌'}</span>
          <span class="badge badge-plain" style="font-weight:700">${t('common.points', { n: s.auto_score })}</span>
        </div>
      </div>`;
    })
    .join('');
  const html = `
    <p class="text-base font-bold mb-3">${t('student.provisionalTotal', { total })}</p>
    <div class="row-list text-left" style="max-height:46vh;overflow-y:auto">${rows}</div>
    <p class="text-xs text-[color:var(--text-faint)] mt-3">${t('student.finalPending')}</p>`;
  window.ui.modal
    .fire({
      title: t('student.examOver'),
      html,
      icon: 'success',
      width: 'min(560px, 94vw)',
      confirmButtonText: t('student.backToDashboard'),
      allowOutsideClick: false,
      allowEscapeKey: false,
    })
    .then(() => {
      try { socket && socket.disconnect(); } catch (_) {}
      enterDashboard();
    });
}

// re-render JS-built content when the language changes
window.addEventListener('i18n:changed', () => {
  if (lastExamData) renderQuestions(lastExamData.questions, lastExamData.submissions);
});

// resume flow on refresh: back to where the student was
async function resume() {
  const user = storedUser();
  setIdentity(user);
  if (user.mustChangePassword) {
    showChangePassword(false);
    return;
  }
  try {
    const res = await fetch(`${API}/me/active-participant`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) return resetToLogin(); // stale/expired token — don't fall through to the dashboard
    if (res.status === 403) return showChangePassword(false);
    if (res.ok) {
      const data = await res.json();
      if (data.participant && data.participant.container_status === 'error') return showProvisionError();
      pendingExamData = data;
      return showWaitingReady();
    }
  } catch {
    /* fall through to dashboard */
  }
  enterDashboard();
}

// ---- forgot password ----
function setForgotStep(n) {
  document.getElementById('forgot-pw-step-indicator').textContent = t('student.stepIndicator', { n, total: 2 });
}

function showForgotPassword() {
  ['forgot-nim-input', 'forgot-otp-input', 'forgot-new-pw-input', 'forgot-confirm-pw-input'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  document.getElementById('forgot-otp-error').textContent = '';
  document.getElementById('forgot-pw-generic-msg').textContent = '';
  document.getElementById('forgot-pw-step1').classList.remove('hidden');
  document.getElementById('forgot-pw-step2').classList.add('hidden');
  setForgotStep(1);
  const nim = document.getElementById('nim-input').value.trim();
  if (nim) document.getElementById('forgot-nim-input').value = nim;
  showScreen('forgotPassword');
  document.getElementById('forgot-nim-input').focus();
}

function goToOtpStep() {
  document.getElementById('forgot-pw-generic-msg').textContent = t('student.forgotPwGeneric');
  document.getElementById('forgot-pw-step1').classList.add('hidden');
  document.getElementById('forgot-pw-step2').classList.remove('hidden');
  setForgotStep(2);
  document.getElementById('forgot-otp-input').focus();
}

async function forgotPasswordRequest() {
  const nim = document.getElementById('forgot-nim-input').value.trim();
  if (!nim) return;
  const btn = document.getElementById('forgot-pw-send-btn');
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

async function forgotPasswordReset() {
  const nim = document.getElementById('forgot-nim-input').value.trim();
  const otp = document.getElementById('forgot-otp-input').value.trim();
  const newPassword = document.getElementById('forgot-new-pw-input').value;
  const confirm = document.getElementById('forgot-confirm-pw-input').value;
  const errEl = document.getElementById('forgot-otp-error');
  errEl.textContent = '';
  if (!otp || !newPassword) return;
  if (newPassword !== confirm) {
    errEl.textContent = t('student.pwMismatch');
    return;
  }
  const btn = document.getElementById('forgot-pw-reset-btn');
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
    showScreen('login');
    document.getElementById('login-error').textContent = '';
    window.ui.toast(data.message || t('student.forgotPwResetOk'));
  } catch {
    errEl.textContent = t('common.requestFailed', { status: 0 });
  } finally {
    btn.disabled = false;
  }
}

// ---- telegram binding ----
let telegramPollTimer = null;

function renderTelegramStatus({ linked, username } = {}) {
  const badge = document.getElementById('telegram-status');
  const connectBtn = document.getElementById('telegram-connect-btn');
  const disconnectBtn = document.getElementById('telegram-disconnect-btn');
  if (linked) {
    badge.className = 'badge badge-green';
    badge.textContent = username ? t('student.telegramLinkedAs', { username }) : t('student.telegramLinked');
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    badge.className = 'badge badge-gray';
    badge.textContent = t('student.telegramNotLinked');
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  }
}

async function loadTelegramStatus() {
  try {
    const res = await fetch(`${API}/me/telegram`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    renderTelegramStatus(await res.json());
  } catch {
    /* leave the default "not linked" state */
  }
}

async function connectTelegram() {
  let data;
  try {
    const res = await fetch(`${API}/me/telegram/link-code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    window.ui.alert(window.i18n.apiError(err && err.message) || t('common.requestFailed', { status: 0 }), { icon: 'error' });
    return;
  }

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
      clearInterval(telegramPollTimer);
      telegramPollTimer = setInterval(async () => {
        try {
          const r = await fetch(`${API}/me/telegram`, { headers: { Authorization: `Bearer ${token}` } });
          if (!r.ok) return;
          const s = await r.json();
          if (s.linked) {
            clearInterval(telegramPollTimer);
            renderTelegramStatus(s);
            window.Swal.close();
            window.ui.toast(t('student.telegramConnected'), 'success');
          }
        } catch {
          /* keep polling */
        }
      }, 3000);
    },
    willClose: () => clearInterval(telegramPollTimer),
  });
}

async function disconnectTelegram() {
  const ok = await window.ui.confirm(t('student.telegramDisconnectConfirm'), { icon: 'warning' });
  if (!ok) return;
  try {
    const res = await fetch(`${API}/me/telegram`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error();
    renderTelegramStatus({ linked: false });
    window.ui.toast(t('student.telegramDisconnected'));
  } catch {
    window.ui.alert(t('common.requestFailed', { status: 0 }), { icon: 'error' });
  }
}

if (token) resume();

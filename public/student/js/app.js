const API = '/api';
const t = (k, v) => window.i18n.t(k, v);
let token = localStorage.getItem('tekser_token') || null;
let socket = null;
let term = null;
let timerInterval = null;
let lastExamData = null; // kept so the question panel can re-render on language change
let lastFinalSubmissions = null;
let examLocked = false;   // anti-cheat: true while the tab-switch lockdown overlay is up

const screens = {
  login: document.getElementById('login-screen'),
  waiting: document.getElementById('waiting-screen'),
  exam: document.getElementById('exam-screen'),
  ended: document.getElementById('ended-screen'),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('nim-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('submit-btn').addEventListener('click', submitExam);

async function login() {
  const nim = document.getElementById('nim-input').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  if (!nim) return;

  try {
    const res = await fetch(`${API}/auth/login/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nim }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    token = data.token;
    localStorage.setItem('tekser_token', token);
    localStorage.setItem('tekser_user', JSON.stringify(data.user || {}));
    setIdentity(data.user);
    checkActiveParticipant();
  } catch (err) {
    errorEl.textContent = window.i18n.apiError(err.message) || t('student.loginFailed');
  }
}

async function checkActiveParticipant() {
  const res = await fetch(`${API}/me/active-participant`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    showScreen('waiting');
    setTimeout(checkActiveParticipant, 5000); // poll until admin starts the session
    return;
  }
  const data = await res.json();
  startExamUi(data);
}

// each step is isolated: if the terminal can't init or the socket can't
// connect (e.g. a vendored lib failed to load, or the container isn't up),
// the questions and the countdown must still work.
function startExamUi(data) {
  lastExamData = data;
  showScreen('exam');

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
    window.Swal && window.Swal.close(); // in case the "submitting..." loading modal is still open
    lastFinalSubmissions = submissions;
    renderFinalResults(submissions);
    showScreen('ended');
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

function renderFinalResults(submissions) {
  const total = submissions.reduce((sum, s) => sum + (s.final_score ?? s.auto_score), 0);
  const rows = submissions
    .map((s) =>
      `<li class="py-1.5 border-b border-[color:var(--border)] last:border-0">${t('student.finalRow', {
        n: s.order_index,
        mark: s.auto_result === 'pass' ? '✅' : '❌',
        score: s.auto_score,
      })}</li>`
    )
    .join('');
  document.getElementById('final-results').innerHTML = `
    <p class="text-lg font-bold mb-3">${t('student.provisionalTotal', { total })}</p>
    <ul class="text-sm">${rows}</ul>
    <p class="text-xs text-[color:var(--text-faint)] mt-3">${t('student.finalPending')}</p>
  `;
}

// re-render JS-built content when the language changes
window.addEventListener('i18n:changed', () => {
  if (lastExamData) renderQuestions(lastExamData.questions, lastExamData.submissions);
  if (lastFinalSubmissions) renderFinalResults(lastFinalSubmissions);
});

// resume flow if the student refreshes mid-exam
if (token) {
  try {
    setIdentity(JSON.parse(localStorage.getItem('tekser_user') || '{}'));
  } catch {
    /* ignore */
  }
  checkActiveParticipant();
}

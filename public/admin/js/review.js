const LEVEL_TONE = { easy: 'green', medium: 'amber', hard: 'red' };
const levelBadge = (level) =>
  window.ui.pill(t('admin.level.' + (level || 'medium')) || level || 'medium', LEVEL_TONE[level] || 'amber');

let reviewMode = 'sesi'; // 'sesi' (per-question) | 'kelas' (whole-kelas read)
let kelasGroups = null; // last Per Kelas payload, for the per-row command lookup

async function loadReviewSessionOptions() {
  const sessions = await apiFetch('/admin/sessions');
  const sel = document.getElementById('review-session-select');
  sel.innerHTML = sessions
    .map((s) => `<option value="${s.id}">${s.name} — UCP ${s.ucp ?? 1}</option>`)
    .join('');

  const questions = await apiFetch('/admin/questions');
  const qSel = document.getElementById('review-question-select');
  qSel.innerHTML = questions
    .map(
      (q) =>
        `<option value="${q.id}">[${(q.level || 'medium').toUpperCase()}] UCP${q.ucp ?? 1} V${q.variant_index ?? '?'} #${q.order_index} - ${q.story_text.slice(0, 32)}...</option>`
    )
    .join('');

  if (reviewMode === 'kelas') await populateKelasOptions();
}
window.loadReviewSessionOptions = loadReviewSessionOptions;

// --- mode toggle ---
function setReviewMode(mode) {
  reviewMode = mode;
  for (const [id, on] of [['review-mode-sesi', mode === 'sesi'], ['review-mode-kelas', mode === 'kelas']]) {
    const b = document.getElementById(id);
    b.classList.toggle('btn-primary', on);
    b.classList.toggle('btn-ghost', !on);
    b.setAttribute('aria-pressed', String(on));
  }
  document.getElementById('review-question-select').classList.toggle('hidden', mode !== 'sesi');
  document.getElementById('review-bulk-accept-btn').classList.toggle('hidden', mode !== 'sesi');
  document.getElementById('review-kelas-select').classList.toggle('hidden', mode !== 'kelas');
  document.getElementById('review-table').innerHTML = '';
  if (mode === 'kelas') populateKelasOptions();
}
document.getElementById('review-mode-sesi').addEventListener('click', () => setReviewMode('sesi'));
document.getElementById('review-mode-kelas').addEventListener('click', () => setReviewMode('kelas'));

async function populateKelasOptions() {
  const sessionId = document.getElementById('review-session-select').value;
  const sel = document.getElementById('review-kelas-select');
  if (!sessionId) {
    sel.innerHTML = '';
    return;
  }
  const { kelas } = await apiFetch(`/admin/review/sessions/${sessionId}/kelas`);
  sel.innerHTML = kelas.length
    ? kelas.map((k) => `<option value="${k}">${t('common.kelas')} ${k}</option>`).join('')
    : `<option value="">${t('admin.reviewNoKelas')}</option>`;
}

document.getElementById('review-load-btn').addEventListener('click', () =>
  reviewMode === 'kelas' ? loadReviewKelasView() : loadReviewTable()
);
document.getElementById('review-bulk-accept-btn').addEventListener('click', async () => {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  await apiFetch(`/admin/review/sessions/${sessionId}/questions/${questionId}/bulk-accept-auto`, { method: 'POST' });
  loadReviewTable();
});

document.getElementById('review-session-select').addEventListener('change', () => {
  updateExportLink();
  if (reviewMode === 'kelas') populateKelasOptions();
});

function updateExportLink() {
  const sessionId = document.getElementById('review-session-select').value;
  const link = document.getElementById('export-csv-link');
  link.href = `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;
}

// ---------- Per Sesi (existing per-question board) ----------
async function loadReviewTable() {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  if (!sessionId || !questionId) return;
  updateExportLink();

  const { question, submissions } = await apiFetch(
    `/admin/review/sessions/${sessionId}/questions/${questionId}`
  );

  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const table = document.getElementById('review-table');
  table.innerHTML = `
    <p class="mb-3 flex flex-wrap items-center gap-2">
      ${levelBadge(question.level)}
      <strong>${escapeHtml(question.story_text)}</strong>
      <span class="text-[color:var(--text-faint)] text-sm">(${t('admin.pointsAndType', { point: question.point, type: question.check_type })})</span>
    </p>
    <div class="overflow-x-auto"><table class="data-table">
      <thead>
        <tr>
          <th>${t('common.nim')}</th><th>${t('admin.auto')}</th><th>${t('admin.commandLog')}</th><th>${t('admin.score')}</th>
        </tr>
      </thead>
      <tbody>
        ${submissions
          .map((s) => {
            const currentFraction = s.final_score !== null && s.final_score !== undefined
              ? s.final_score / question.point
              : s.auto_score / question.point;
            const logLines = s.command_log
              .map((c) => `[${c.exit_code}] ${c.raw_command}`)
              .join('\n') || t('admin.noMatchingCmd');
            return `
              <tr>
                <td class="pr-2 font-mono">${s.nim}<br><small class="text-[color:var(--text-faint)]">${escapeHtml(s.name || '')}${s.kelas ? ' · ' + escapeHtml(s.kelas) : ''}</small></td>
                <td class="pr-2">${s.auto_result === 'pass' ? '✅' : s.auto_result === 'fail' ? '❌' : '—'}</td>
                <td class="pr-2 font-mono text-xs text-[color:var(--text-muted)] max-w-xs">
                  <pre class="whitespace-pre-wrap">${escapeHtml(logLines)}</pre>
                  <button class="show-full-log text-[color:var(--accent-hover)] text-xs hover:underline mt-1" data-participant="${s.participant_id}">${t('admin.viewAllCmds')}</button>
                </td>
                <td class="whitespace-nowrap">
                  ${fractions
                    .map(
                      (f) => `<button class="score-btn btn btn-sm ${Math.abs(currentFraction - f) < 0.01 ? 'btn-primary' : 'btn-ghost'} m-0.5"
                        data-participant="${s.participant_id}" data-fraction="${f}">${f * 100}%</button>`
                    )
                    .join('')}
                </td>
              </tr>`;
          })
          .join('')}
      </tbody>
    </table></div>`;

  table.querySelectorAll('.score-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const participantId = btn.dataset.participant;
      const fraction = parseFloat(btn.dataset.fraction);
      await apiFetch(`/admin/review/submissions/${participantId}/${questionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fraction }),
      });
      loadReviewTable();
    });
  });

  wireFullLogButtons(table);
}

// ---------- Per Kelas (one continuous read, grouped by variant) ----------
async function loadReviewKelasView() {
  const sessionId = document.getElementById('review-session-select').value;
  const kelas = document.getElementById('review-kelas-select').value;
  if (!sessionId || !kelas) return;
  updateExportLink();

  const table = document.getElementById('review-table');
  table.innerHTML = `<div class="row-list">${Array.from({ length: 3 }, () => '<div class="skeleton skeleton-row"></div>').join('')}</div>`;
  const { groups } = await apiFetch(`/admin/review/sessions/${sessionId}/kelas/${kelas}`);
  kelasGroups = groups;

  const totalQuestions = groups.reduce((n, g) => n + g.questions.length, 0);
  if (totalQuestions === 0) {
    table.innerHTML = `<div class="empty-state"><div class="empty-state__title">${escapeHtml(t('admin.reviewKelasEmpty'))}</div></div>`;
    return;
  }

  const checkLabel = (ct) =>
    ct === 'state_check' ? t('admin.stateCheckLabel') : ct === 'both' ? t('admin.bothCheckLabel') : t('admin.acceptedPatternsLabel');
  const patterns = (raw) => {
    try {
      const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      return arr.join('  |  ');
    } catch {
      return '';
    }
  };
  const showVariantHeaders = groups.length > 1;

  table.innerHTML = groups
    .map((g) => {
      const header = showVariantHeaders
        ? `<div class="section-label mb-2 mt-4">${escapeHtml(t('admin.variantN', { n: g.variant_index }))}</div>`
        : '';
      const qs = g.questions
        .map((q) => {
          const pat = patterns(q.accepted_patterns);
          const rows = q.submissions
            .map((s) => {
              const attempted = s.auto_result != null;
              const mark = s.auto_result === 'pass' ? '✅' : s.auto_result === 'fail' ? '❌' : attempted ? '—' : `<span class="text-[color:var(--text-faint)]">${t('admin.noAttempt')}</span>`;
              const eff = (s.final_score ?? s.auto_score) ?? 0;
              return `<tr>
                <td class="pr-3 font-mono whitespace-nowrap">${escapeHtml(s.nim)}<br><small class="text-[color:var(--text-faint)]">${escapeHtml(s.name || '')}</small></td>
                <td class="pr-3">${mark}</td>
                <td class="pr-3 whitespace-nowrap">${eff} / ${q.point}</td>
                <td><button class="rk-log btn btn-sm btn-ghost" data-participant="${s.participant_id}" data-question="${q.id}">${t('admin.viewCmd')}</button></td>
              </tr>`;
            })
            .join('');
          return `
            <div class="card mb-3">
              <div class="flex flex-wrap items-center gap-2 mb-1">
                <span class="badge badge-plain" style="font-weight:700">#${q.order_index}</span>
                <strong>${escapeHtml(q.story_text)}</strong>
                <span class="text-[color:var(--text-faint)] text-sm">${t('common.points', { n: q.point })}</span>
              </div>
              ${q.story_text_en ? `<p class="text-sm text-[color:var(--text-muted)] mb-1">${escapeHtml(q.story_text_en)}</p>` : ''}
              <p class="text-xs text-[color:var(--text-faint)] mb-2">${escapeHtml(checkLabel(q.check_type))}${pat ? ': ' : ''}<span class="font-mono">${escapeHtml(pat)}</span></p>
              <div class="overflow-x-auto"><table class="data-table"><tbody>${rows}</tbody></table></div>
            </div>`;
        })
        .join('');
      return header + qs;
    })
    .join('');

  wireFullLogButtons(table);
}

function wireFullLogButtons(root) {
  // Per Sesi: whole-exam log for this participant.
  root.querySelectorAll('.show-full-log').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const fullLog = await apiFetch(`/admin/review/participants/${btn.dataset.participant}/command-log`);
      const lines =
        fullLog.map((c) => `[${c.exit_code}] ${c.raw_command}`).join('\n') || t('admin.noCmdsAtAll');
      window.ui.alertPre(t('admin.allCmdsTitle'), lines);
    });
  });

  // Per Kelas: this question's log for this participant, matched line flagged.
  // Grading is by regex / state check, so this is "what they typed", not a canonical answer.
  root.querySelectorAll('.rk-log').forEach((btn) => {
    btn.addEventListener('click', () => {
      const g = (kelasGroups || []).flatMap((x) => x.questions).find((q) => String(q.id) === btn.dataset.question);
      const s = g && g.submissions.find((x) => String(x.participant_id) === btn.dataset.participant);
      const log = (s && s.command_log) || [];
      const lines = log.length
        ? log.map((c) => `${c.id === (s && s.matched_command_log_id) ? '» ' : '  '}[${c.exit_code}] ${c.raw_command}`).join('\n')
        : t('admin.noMatchingCmd');
      window.ui.alertPre(`${s ? s.nim : ''} — #${g ? g.order_index : ''}`, lines);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener('i18n:changed', () => {
  if (!document.getElementById('review-table').innerHTML) return;
  if (reviewMode === 'kelas') loadReviewKelasView();
  else loadReviewTable();
});

const LEVEL_TONE = { easy: 'green', medium: 'amber', hard: 'red' };
const levelBadge = (level) =>
  window.ui.pill(t('admin.level.' + (level || 'medium')) || level || 'medium', LEVEL_TONE[level] || 'amber');

async function loadReviewSessionOptions() {
  const sessions = await apiFetch('/admin/sessions');
  const sel = document.getElementById('review-session-select');
  sel.innerHTML = sessions.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  const questions = await apiFetch('/admin/questions');
  const qSel = document.getElementById('review-question-select');
  qSel.innerHTML = questions
    .map(
      (q) =>
        `<option value="${q.id}">[${(q.level || 'medium').toUpperCase()}] #${q.order_index} - ${q.story_text.slice(0, 40)}...</option>`
    )
    .join('');
}
window.loadReviewSessionOptions = loadReviewSessionOptions;

document.getElementById('review-load-btn').addEventListener('click', loadReviewTable);
document.getElementById('review-bulk-accept-btn').addEventListener('click', async () => {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  await apiFetch(`/admin/review/sessions/${sessionId}/questions/${questionId}/bulk-accept-auto`, { method: 'POST' });
  loadReviewTable();
});

document.getElementById('review-session-select').addEventListener('change', updateExportLink);

function updateExportLink() {
  const sessionId = document.getElementById('review-session-select').value;
  const link = document.getElementById('export-csv-link');
  link.href = `${API}/admin/review/sessions/${sessionId}/export.csv?token=${adminToken}`;
}

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
    <table class="data-table">
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
    </table>`;

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

  table.querySelectorAll('.show-full-log').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const participantId = btn.dataset.participant;
      const fullLog = await apiFetch(`/admin/review/participants/${participantId}/command-log`);
      const lines = fullLog.map((c) => `[${c.exit_code}] ${c.raw_command}`).join('\n') || t('admin.noCmdsAtAll');
      window.ui.alertPre(t('admin.allCmdsTitle'), lines);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.addEventListener('i18n:changed', () => {
  const sessionId = document.getElementById('review-session-select').value;
  const questionId = document.getElementById('review-question-select').value;
  if (sessionId && questionId && document.getElementById('review-table').innerHTML) loadReviewTable();
});

function connectAdminSocket() {
  const socket = io();
  socket.emit('admin:join', { token: adminToken });

  socket.on('admin:score_update', ({ nim, solvedCount, totalQuestions }) => {
    // lightweight live signal; participant table refresh stays on-demand via loadParticipants
    console.log(`[live] ${nim} solved ${solvedCount}/${totalQuestions}`);
  });

  // anti-cheat: a participant left their exam tab. Detection + audit only — a
  // non-blocking toast; the running count lives on the session page.
  socket.on('admin:violation', ({ nim, name, violationCount }) => {
    window.ui.toast(t('admin.violationAlert', { who: name || nim, n: violationCount }), 'warning');
  });
}
window.connectAdminSocket = connectAdminSocket;

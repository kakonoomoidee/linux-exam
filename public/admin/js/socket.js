function connectAdminSocket() {
  const socket = io();
  socket.emit('admin:join', { token: adminToken });

  socket.on('admin:score_update', ({ nim, solvedCount, totalQuestions }) => {
    // lightweight live signal; participant table refresh stays on-demand via loadParticipants
    console.log(`[live] ${nim} solved ${solvedCount}/${totalQuestions}`);
  });

  // anti-cheat: a participant left their exam tab. Show the unlock code big so
  // the assistant can read it out, and refresh the open participant list.
  socket.on('admin:violation', ({ nim, name, code, violationCount }) => {
    window.ui.alert(
      t('admin.violationAlert', { who: name || nim, code, n: violationCount }),
      { icon: 'warning', title: `🔒 ${code}` }
    );
    if (window.getOpenSessionId?.()) window.loadParticipants(window.getOpenSessionId());
  });

  socket.on('admin:unlocked', ({ nim }) => {
    window.ui.toast(t('admin.unlockedToast', { nim }), 'success');
    if (window.getOpenSessionId?.()) window.loadParticipants(window.getOpenSessionId());
  });
}
window.connectAdminSocket = connectAdminSocket;

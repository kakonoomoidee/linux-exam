function connectAdminSocket() {
  const socket = io();
  socket.emit('admin:join', { token: adminToken });

  socket.on('admin:score_update', ({ nim, solvedCount, totalQuestions }) => {
    // lightweight live signal; participant table refresh stays on-demand via loadParticipants
    console.log(`[live] ${nim} solved ${solvedCount}/${totalQuestions}`);
  });

  // anti-cheat: a participant left their exam tab. Show the unlock code big so
  // the assistant can read it out. The live per-participant list lives on the
  // standalone session page (session-form.js), which refreshes itself on this
  // same event.
  socket.on('admin:violation', ({ nim, name, code, violationCount }) => {
    window.ui.alert(
      t('admin.violationAlert', { who: name || nim, code, n: violationCount }),
      { icon: 'warning', title: `🔒 ${code}` }
    );
  });

  socket.on('admin:unlocked', ({ nim }) => {
    window.ui.toast(t('admin.unlockedToast', { nim }), 'success');
  });
}
window.connectAdminSocket = connectAdminSocket;

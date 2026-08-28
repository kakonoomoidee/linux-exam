function connectAdminSocket() {
  const socket = io();
  socket.emit('admin:join', { token: adminToken });

  socket.on('admin:score_update', ({ nim, solvedCount, totalQuestions }) => {
    // lightweight live signal; participant table refresh stays on-demand via loadParticipants
    console.log(`[live] ${nim} solved ${solvedCount}/${totalQuestions}`);
  });
}
window.connectAdminSocket = connectAdminSocket;

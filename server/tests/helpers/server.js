/** Boots the real Express app + Socket.IO on an ephemeral port for tests that
 * need a live socket (the HTTP-only tests use supertest against buildApp()). */
const http = require('node:http');
const buildApp = require('../../src/app');
const { initSockets } = require('../../src/sockets');

async function startServer() {
  const app = buildApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    io,
    async close() {
      io.close();
      await new Promise((res) => server.close(res));
    },
  };
}

module.exports = { startServer };

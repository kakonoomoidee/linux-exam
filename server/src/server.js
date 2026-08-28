const http = require('http');
const config = require('./config');
const buildApp = require('./app');
const { initSockets } = require('./sockets');
const migrate = require('./db/migrate');

(async () => {
  await migrate(); // idempotent, safe to run on every boot

  const app = buildApp();
  const httpServer = http.createServer(app);
  initSockets(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`[tekser] server listening on http://localhost:${config.port}`);
    console.log(`[tekser] container driver: ${config.containerDriver}`);
  });
})().catch((err) => {
  console.error('[tekser] failed to start', err);
  process.exit(1);
});

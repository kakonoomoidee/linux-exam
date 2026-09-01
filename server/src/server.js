const http = require('http');
const config = require('./config');
const buildApp = require('./app');
const { initSockets } = require('./sockets');
const migrate = require('./db/migrate');
const telegramBot = require('./services/telegramBot');

(async () => {
  await migrate(); // idempotent, safe to run on every boot

  const app = buildApp();
  const httpServer = http.createServer(app);
  initSockets(httpServer);
  telegramBot.start(); // long-polling bot; no-op when TELEGRAM_BOT_TOKEN is unset

  // First shutdown handler in the codebase — added so the poll loop stops cleanly.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      telegramBot.stop();
      process.exit(0);
    });
  }

  httpServer.listen(config.port, () => {
    console.log(`[tekser] server listening on http://localhost:${config.port}`);
    console.log(`[tekser] container driver: ${config.containerDriver}`);
  });
})().catch((err) => {
  console.error('[tekser] failed to start', err);
  process.exit(1);
});

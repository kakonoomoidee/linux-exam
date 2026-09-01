// The single Telegram transport instance for the whole process (mock or real,
// chosen by config). Mirrors `const driver = buildDriver()` in containerService.js.
// Everything that sends a Telegram message imports this.
const { buildTelegram } = require('../lib/telegram');

module.exports = buildTelegram();

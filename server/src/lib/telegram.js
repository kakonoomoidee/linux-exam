/**
 * Telegram bot transport, mock vs real — same shape as services/containerDrivers.js.
 * The server has no public URL, so the real driver uses long-polling (getUpdates),
 * not a webhook. Everything that talks to Telegram goes through here so it's mocked
 * in one place for tests and audited in one place for security.
 *
 * Disabled mode: if there's no bot token (dev/test), buildTelegram() returns
 * MockTelegram — the app runs normally, sends become log lines, polling is a no-op.
 */
const config = require('../config');

const API = 'https://api.telegram.org';
const isTest = () => process.env.NODE_ENV === 'test';

class RealTelegram {
  constructor(token) {
    this.token = token;
    this._stopped = false;
    this._offset = 0;
  }

  async sendMessage(chatId, text) {
    try {
      const res = await fetch(`${API}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        console.error(`[telegram] sendMessage ${chatId} -> HTTP ${res.status}: ${await res.text()}`);
      }
    } catch (err) {
      // A failed send must never bubble into the caller (OTP dispatch is
      // fire-and-forget) — log and move on.
      console.error(`[telegram] sendMessage ${chatId} failed`, err);
    }
  }

  /**
   * Long-poll loop. `onMessage({ chat: { id, username }, text })` is invoked for
   * every incoming text message. Runs until stop().
   * ponytail: single in-process poller, no clustering. Offset is in-memory, so a
   * restart may re-deliver the last few updates — /start <code> is safe to repeat
   * (codes are single-use and expire) so at-least-once is fine.
   */
  async poll(onMessage) {
    while (!this._stopped) {
      let updates;
      try {
        const res = await fetch(
          `${API}/bot${this.token}/getUpdates?timeout=50&offset=${this._offset}&allowed_updates=["message"]`
        );
        const body = await res.json();
        updates = body.ok ? body.result : [];
        if (!body.ok) console.error('[telegram] getUpdates not ok', body);
      } catch (err) {
        if (this._stopped) break;
        console.error('[telegram] getUpdates failed, backing off 5s', err);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      for (const u of updates) {
        this._offset = u.update_id + 1;
        const m = u.message;
        if (!m || typeof m.text !== 'string') continue;
        try {
          await onMessage({ chat: { id: m.chat.id, username: m.chat.username || null }, text: m.text });
        } catch (err) {
          console.error('[telegram] onMessage handler threw', err);
        }
      }
    }
  }

  stop() {
    this._stopped = true;
  }
}

class MockTelegram {
  constructor() {
    this.sent = []; // outbox, asserted by tests
    this._handler = null;
  }

  async sendMessage(chatId, text) {
    this.sent.push({ chatId: String(chatId), text });
    if (!isTest()) {
      console.warn(`[telegram:disabled] would send to ${chatId}: ${text.replace(/\n/g, ' ')}`);
    }
  }

  async poll(onMessage) {
    // No network. Tests call _handler directly (or telegramBot.handleMessage).
    this._handler = onMessage;
  }

  stop() {}

  _reset() {
    this.sent.length = 0;
    this._handler = null;
  }
}

function buildTelegram() {
  return config.telegramBotToken && !isTest()
    ? new RealTelegram(config.telegramBotToken)
    : new MockTelegram();
}

module.exports = { buildTelegram, RealTelegram, MockTelegram };

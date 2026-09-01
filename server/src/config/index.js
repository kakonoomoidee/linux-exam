// Single .env lives at the repo root (shared with docker-compose). Loaded by
// absolute path so it works no matter the cwd. Inside a container the file is
// absent and compose injects the vars directly — dotenv just no-ops.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

// PostgreSQL connection. Use DATABASE_URL if given, else assemble from the
// DB_* parts. DB_PORT is not hardcoded to 5432 so it can dodge a PostgreSQL
// already running on the host (see docker-compose.yml / .env).
const databaseUrl =
  process.env.DATABASE_URL ||
  `postgres://${process.env.DB_USER || 'tekser'}:${process.env.DB_PASSWORD || 'tekser'}` +
    `@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5434'}/${process.env.DB_NAME || 'tekser'}`;

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  databaseUrl,

  containerDriver: process.env.CONTAINER_DRIVER || 'mock', // 'docker' | 'mock'
  sandboxImage: process.env.SANDBOX_IMAGE || 'tekser-sandbox:latest',
  // Dedicated internal-only Docker network sandbox containers join — no
  // route to the internet, but can still reach the `app` service by name
  // for command-log callbacks (see docker-compose.yml `networks:`).
  sandboxNetwork: process.env.SANDBOX_NETWORK || 'tekser-sandbox-net',
  containerMemoryMb: parseInt(process.env.CONTAINER_MEMORY_MB || '128', 10),
  containerCpus: parseFloat(process.env.CONTAINER_CPUS || '0.5'),
  containerPidsLimit: parseInt(process.env.CONTAINER_PIDS_LIMIT || '64', 10),
  // Default assumes docker-compose usage, where sandbox containers reach the
  // app by its compose service name. Only relevant if CMD_LOG_CALLBACK_URL
  // isn't set explicitly (compose always sets it — see docker-compose.yml).
  cmdLogCallbackUrl: process.env.CMD_LOG_CALLBACK_URL || 'http://app:3000/api/cmd-log',

  defaultSessionDurationMinutes: parseInt(process.env.DEFAULT_SESSION_DURATION_MINUTES || '10', 10),

  // Telegram bot for forgot-password OTP. Unset => feature disabled (lib/telegram
  // falls back to a no-op MockTelegram that logs instead of sending).
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || null,
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null, // shown in the "/start <code>" instruction
  otpTtlMinutes: parseInt(process.env.OTP_TTL_MINUTES || '10', 10),

  // Admin account re-seeded on every boot (see db/migrate.js).
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',

  isProd: process.env.NODE_ENV === 'production',
};

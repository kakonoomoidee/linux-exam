-- Tekser Exam Platform schema (PostgreSQL)
-- Table order matters here: PostgreSQL resolves REFERENCES immediately, so a
-- table must be created after everything it points at (questions before
-- session_participants, etc).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  nim           TEXT UNIQUE NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'student', -- 'student' | 'asisten' | 'instruktur'
  password_hash TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL DEFAULT 10,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | running | ended
  started_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_variants (
  id            SERIAL PRIMARY KEY,
  variant_index INTEGER NOT NULL UNIQUE -- 0-9
);

CREATE TABLE IF NOT EXISTS questions (
  id                    SERIAL PRIMARY KEY,
  variant_id            INTEGER NOT NULL REFERENCES question_variants(id) ON DELETE CASCADE,
  order_index           INTEGER NOT NULL,
  story_text            TEXT NOT NULL,
  point                 DOUBLE PRECISION NOT NULL DEFAULT 1,
  check_type            TEXT NOT NULL DEFAULT 'command_match', -- command_match | state_check | both
  accepted_patterns     TEXT, -- JSON array of regex strings (case-insensitive, matched against normalized command)
  state_checker_script  TEXT, -- bash script run inside container at session end, must print PASS or FAIL as last line
  UNIQUE(variant_id, order_index)
);

CREATE TABLE IF NOT EXISTS session_participants (
  id                 SERIAL PRIMARY KEY,
  session_id         INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  variant_index      INTEGER NOT NULL, -- 0-9, derived from last digit of NIM
  container_id       TEXT,
  container_status   TEXT NOT NULL DEFAULT 'not_started',
    -- not_started | provisioning | ready | active | ended | destroyed | error
  session_token      TEXT,
  started_at         TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  active_question_id INTEGER REFERENCES questions(id),
  UNIQUE(session_id, user_id)
);

CREATE TABLE IF NOT EXISTS command_logs (
  id                  SERIAL PRIMARY KEY,
  participant_id      INTEGER NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
  question_id         INTEGER REFERENCES questions(id),
  raw_command         TEXT NOT NULL,
  normalized_command  TEXT NOT NULL,
  exit_code           INTEGER,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id                      SERIAL PRIMARY KEY,
  participant_id          INTEGER NOT NULL REFERENCES session_participants(id) ON DELETE CASCADE,
  question_id             INTEGER NOT NULL REFERENCES questions(id),
  auto_result             TEXT NOT NULL DEFAULT 'unmatched', -- pass | fail | unmatched
  auto_score              DOUBLE PRECISION NOT NULL DEFAULT 0,
  final_score             DOUBLE PRECISION, -- nullable, set on manual override (0/25/50/75/100 as fraction of point)
  matched_command_log_id  INTEGER REFERENCES command_logs(id),
  reviewed_by             INTEGER REFERENCES users(id),
  reviewed_at             TIMESTAMPTZ,
  UNIQUE(participant_id, question_id)
);

-- Anti-cheat: lockdown-on-tab-switch. Additive and idempotent — safe to run
-- on an existing production database with data (schema.sql runs on every boot).
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS lock_code       TEXT;
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS locked_at       TIMESTAMPTZ;
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS violation_count INTEGER NOT NULL DEFAULT 0;

-- Student "Kelas", bilingual question text, and question difficulty. Additive and
-- idempotent — safe to run on an existing production database with data.
-- story_text stays the Indonesian version; story_text_en may be NULL (older rows).
ALTER TABLE users     ADD COLUMN IF NOT EXISTS kelas         TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS story_text_en TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS level         TEXT DEFAULT 'medium'; -- easy | medium | hard

-- Student password (default = NIM, forced change on first login) + session join code.
-- Additive and idempotent. password_hash already exists (staff use it) and is reused;
-- existing student rows keep password_hash = NULL and the login path treats that as
-- "password is the NIM, must change" regardless of the stored flag.
ALTER TABLE users    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS join_code            TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_join_code ON sessions(join_code) WHERE join_code IS NOT NULL;

-- UCP 1 / UCP 2 split for sessions and the question bank. Additive and idempotent;
-- existing rows land in UCP 1. The kelas CHECK constraint and the questions
-- (variant_id, ucp, order_index) unique-key swap are applied by migrate.js after
-- the one-time kelas data normalization (guarded DO blocks — see migrate.js).
ALTER TABLE sessions  ADD COLUMN IF NOT EXISTS ucp SMALLINT NOT NULL DEFAULT 1; -- 1 | 2
ALTER TABLE questions ADD COLUMN IF NOT EXISTS ucp SMALLINT NOT NULL DEFAULT 1; -- 1 | 2

CREATE INDEX IF NOT EXISTS idx_cmdlog_participant ON command_logs(participant_id, question_id);
CREATE INDEX IF NOT EXISTS idx_submissions_participant ON submissions(participant_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON session_participants(session_id);

-- Telegram binding + password-reset-via-OTP + audit log. Additive and idempotent —
-- safe to run on an existing production database with data (schema.sql runs on every boot).
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
-- One Telegram account maps to at most one student. Staff can move a binding
-- (clear the old row's field first, or PATCH the new student) if a phone changes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_chat_id
  ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Single-use codes a student sends to the bot as `/start <code>` to link their
-- Telegram account. Short TTL; caller invalidates any prior unused code first.
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code        TEXT PRIMARY KEY,                       -- joinCode.generate(): 32-char alphabet, length 6
  user_id     INTEGER NOT NULL REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tg_link_codes_user ON telegram_link_codes(user_id);

-- Forgot-password OTPs. The 6-digit code is bcrypt-hashed at rest, never stored
-- plaintext. Requesting a new OTP consumes any pending one (see passwordResetService).
CREATE TABLE IF NOT EXISTS password_reset_otps (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  otp_hash    TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pw_reset_otps_user ON password_reset_otps(user_id);

-- Oversight trail: who logged in, who changed a Telegram binding, password resets.
-- action is a free string (additive — new event types need no migration).
CREATE TABLE IF NOT EXISTS audit_logs (
  id             SERIAL PRIMARY KEY,
  actor_type     TEXT NOT NULL,                       -- 'student' | 'staff' | 'system'
  actor_id       INTEGER REFERENCES users(id),        -- nullable (system)
  action         TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(id),        -- nullable
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target  ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

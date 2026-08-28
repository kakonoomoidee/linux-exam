-- Tekser Exam Platform schema (PostgreSQL)
-- Table order matters here: PostgreSQL resolves REFERENCES immediately, so a
-- table must be created after everything it points at (questions before
-- session_participants, etc).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  nim           TEXT UNIQUE NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'student', -- 'student' | 'admin'
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

CREATE INDEX IF NOT EXISTS idx_cmdlog_participant ON command_logs(participant_id, question_id);
CREATE INDEX IF NOT EXISTS idx_submissions_participant ON submissions(participant_id);
CREATE INDEX IF NOT EXISTS idx_participants_session ON session_participants(session_id);

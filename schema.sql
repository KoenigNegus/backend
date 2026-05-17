-- ─────────────────────────────────────────────────────────────────────────────
-- SmartLift database schema (PostgreSQL).
-- This file is executed automatically when the server starts.
-- Every statement is idempotent (IF NOT EXISTS) so it is safe to run repeatedly.
--
-- gen_random_uuid() is built into PostgreSQL 13+ (which Aiven uses), so no
-- extension is required.
-- ─────────────────────────────────────────────────────────────────────────────

-- Core identity ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password    TEXT NOT NULL,                       -- bcrypt hash, never plain text
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One profile row per user (created lazily on first read) ---------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  activities        JSONB NOT NULL DEFAULT '["Gym"]',
  fitness_level     TEXT  NOT NULL DEFAULT 'Beginner',
  days_per_week     INT   NOT NULL DEFAULT 3,
  custom_goals      TEXT  NOT NULL DEFAULT '',
  calorie_goal      INT   NOT NULL DEFAULT 2500,
  protein_goal      INT   NOT NULL DEFAULT 150,
  carbs_goal        INT   NOT NULL DEFAULT 300,
  fat_goal          INT   NOT NULL DEFAULT 80,
  age               INT,
  height            REAL,
  weight            REAL,
  health_conditions JSONB NOT NULL DEFAULT '[]',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workout blueprints (templates) ----------------------------------------------
-- exercises is a JSON array: [{ "name": "...", "sets": 3, "reps": 10 }]
CREATE TABLE IF NOT EXISTS workouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  duration_minutes  INT  NOT NULL DEFAULT 60,
  calories_burned   INT,
  exercises         JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Completed workout sessions --------------------------------------------------
-- exercises is a JSON array:
--   [{ "name": "...", "completedSets": [{ "reps": 8, "weight": 60, "rpe": 7 }] }]
CREATE TABLE IF NOT EXISTS workout_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id       UUID,
  title             TEXT NOT NULL,
  performed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_minutes  INT  NOT NULL DEFAULT 0,
  exercises         JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nutrition -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  calories   INT NOT NULL DEFAULT 0,
  protein_g  INT NOT NULL DEFAULT 0,
  carbs_g    INT NOT NULL DEFAULT 0,
  fat_g      INT NOT NULL DEFAULT 0,
  portion    TEXT NOT NULL DEFAULT '',
  image_uri  TEXT
);

-- Chat history ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content  TEXT NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pre-compressed weekly snapshots for the AI context engine -------------------
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start         DATE NOT NULL,
  week_end           DATE NOT NULL,
  workout_count      INT  NOT NULL DEFAULT 0,
  total_volume_kg    REAL NOT NULL DEFAULT 0,
  avg_daily_calories INT  NOT NULL DEFAULT 0,
  protein_hit_rate   REAL NOT NULL DEFAULT 0,
  ai_summary         TEXT,
  confidence_score   REAL NOT NULL DEFAULT 1.0,
  data_gap_days      INT  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

-- Indexes for the most common lookups -----------------------------------------
CREATE INDEX IF NOT EXISTS idx_workouts_user  ON workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_user      ON workout_logs(user_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_meals_user     ON meals(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_chat_user      ON chat_messages(user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_summaries_user ON weekly_summaries(user_id, week_start);

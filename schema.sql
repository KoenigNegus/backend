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

-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1: Core Gym Suite Extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- Catalog of all exercises ----------------------------------------------------
CREATE TABLE IF NOT EXISTS exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT UNIQUE NOT NULL,
  muscle_group TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template Routines -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS template_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  exercise_id  UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  sets         INT NOT NULL DEFAULT 3,
  reps         INT NOT NULL DEFAULT 10,
  order_index  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeding Exercises -----------------------------------------------------------
INSERT INTO exercises (name, muscle_group) VALUES
  -- Chest
  ('Barbell Bench Press', 'Chest'),
  ('Incline Dumbbell Press', 'Chest'),
  ('Cable Crossover', 'Chest'),
  ('Push-ups', 'Chest'),
  ('Dumbbell Flyes', 'Chest'),
  ('Machine Chest Press', 'Chest'),
  ('Decline Bench Press', 'Chest'),
  -- Back
  ('Pull-ups', 'Back'),
  ('Lat Pulldown', 'Back'),
  ('Barbell Row', 'Back'),
  ('Seated Cable Row', 'Back'),
  ('T-Bar Row', 'Back'),
  ('Single-Arm Dumbbell Row', 'Back'),
  ('Deadlift', 'Back'),
  -- Shoulders
  ('Overhead Press', 'Shoulders'),
  ('Dumbbell Lateral Raise', 'Shoulders'),
  ('Front Raise', 'Shoulders'),
  ('Face Pulls', 'Shoulders'),
  ('Arnold Press', 'Shoulders'),
  ('Upright Row', 'Shoulders'),
  ('Reverse Pec Deck', 'Shoulders'),
  -- Legs
  ('Barbell Squat', 'Legs'),
  ('Leg Press', 'Legs'),
  ('Romanian Deadlift', 'Legs'),
  ('Leg Extension', 'Legs'),
  ('Lying Leg Curl', 'Legs'),
  ('Standing Calf Raise', 'Legs'),
  ('Seated Calf Raise', 'Legs'),
  ('Walking Lunges', 'Legs'),
  ('Bulgarian Split Squat', 'Legs'),
  -- Arms
  ('Barbell Curl', 'Arms'),
  ('Dumbbell Hammer Curl', 'Arms'),
  ('Preacher Curl', 'Arms'),
  ('Triceps Pushdown', 'Arms'),
  ('Overhead Triceps Extension', 'Arms'),
  ('Skull Crushers', 'Arms'),
  ('Concentration Curl', 'Arms'),
  -- Core
  ('Crunch', 'Core'),
  ('Plank', 'Core'),
  ('Hanging Leg Raise', 'Core'),
  ('Russian Twist', 'Core'),
  ('Ab Wheel Rollout', 'Core'),
  -- Athletic & Explosive (User Request)
  ('Power Clean', 'Athletic'),
  ('Box Jumps', 'Athletic'),
  ('80m Sprint', 'Athletic'),
  ('100m Sprint', 'Athletic'),
  ('Plyo Push-ups', 'Athletic'),
  ('Kettlebell Swings', 'Athletic'),
  ('Medicine Ball Slams', 'Athletic'),
  ('Sled Push', 'Athletic'),
  -- Additional Core
  ('Cable Woodchopper', 'Core'),
  ('Bicycle Crunches', 'Core'),
  ('V-Ups', 'Core'),
  ('Flutter Kicks', 'Core'),
  ('Hanging Knee Raise', 'Core'),
  ('Dragon Flag', 'Core'),
  -- Additional Legs
  ('Goblet Squat', 'Legs'),
  ('Front Squat', 'Legs'),
  ('Hack Squat', 'Legs'),
  ('Sumo Deadlift', 'Legs'),
  ('Hip Thrust', 'Legs'),
  ('Glute Bridge', 'Legs'),
  ('Seated Leg Curl', 'Legs'),
  ('Sissy Squat', 'Legs'),
  -- Additional Back
  ('Close-Grip Pulldown', 'Back'),
  ('Straight-Arm Pulldown', 'Back'),
  ('Chest-Supported Row', 'Back'),
  ('Pendlay Row', 'Back'),
  ('Meadows Row', 'Back'),
  ('Rack Pull', 'Back'),
  ('Good Morning', 'Back'),
  -- Additional Chest
  ('Dumbbell Bench Press', 'Chest'),
  ('Incline Barbell Press', 'Chest'),
  ('Decline Dumbbell Press', 'Chest'),
  ('Pec Deck Machine', 'Chest'),
  ('Floor Press', 'Chest'),
  ('Dips (Chest Focus)', 'Chest'),
  -- Additional Shoulders
  ('Seated Dumbbell Press', 'Shoulders'),
  ('Machine Shoulder Press', 'Shoulders'),
  ('Cable Lateral Raise', 'Shoulders'),
  ('Leaning Lateral Raise', 'Shoulders'),
  ('Rear Delt Fly', 'Shoulders'),
  ('Push Press', 'Shoulders'),
  -- Additional Arms
  ('EZ-Bar Curl', 'Arms'),
  ('Incline Dumbbell Curl', 'Arms'),
  ('Cable Curl', 'Arms'),
  ('Reverse Curl', 'Arms'),
  ('Close-Grip Bench Press', 'Arms'),
  ('Triceps Dip', 'Arms'),
  ('Rope Pushdown', 'Arms'),
  ('Overhead Cable Extension', 'Arms')
ON CONFLICT (name) DO NOTHING;

-- Scaffold-feature tables: feature flags, achievements, family plan,
-- student discount.
--
-- The routes in feature_flags.py / gamification.py / family.py /
-- student_discount.py have queried these tables with raw SQL since they
-- shipped, but nothing in the repo ever created them — a fresh database
-- 500'd on every one of those endpoints. This migration provisions them
-- to match the new models in schema.prisma (same @map names), and seeds
-- the achievement definitions that /achievements/check expects to exist.
--
-- Idempotent: safe to run on databases where some or all of these tables
-- were previously created by hand (including student_verifications, which
-- the routes used to CREATE TABLE IF NOT EXISTS at request time).
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations_manual/2026_07_03_scaffold_tables.sql
-- Then: prisma generate

BEGIN;

-- ── Feature flags ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_flags (
  id          SERIAL       PRIMARY KEY,
  flag_key    VARCHAR(100) NOT NULL,
  description TEXT,
  enabled     BOOLEAN      NOT NULL DEFAULT false,
  rollout_pct INTEGER      NOT NULL DEFAULT 100,
  variants    JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_flag_key_key UNIQUE (flag_key)
);

CREATE TABLE IF NOT EXISTS user_feature_flags (
  id          SERIAL       PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_key    VARCHAR(100) NOT NULL REFERENCES feature_flags(flag_key) ON DELETE CASCADE,
  variant     VARCHAR(50),
  assigned_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Backs the ON CONFLICT (user_id, flag_key) upsert in /flags/me.
  CONSTRAINT user_feature_flags_user_id_flag_key_key UNIQUE (user_id, flag_key)
);

-- ── Achievements (gamification badges) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS achievements (
  key         VARCHAR(50)  PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  icon        VARCHAR(20),
  category    VARCHAR(30)  NOT NULL,
  threshold   INTEGER      NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_achievements (
  id              SERIAL      PRIMARY KEY,
  user_id         INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key VARCHAR(50) NOT NULL REFERENCES achievements(key) ON DELETE CASCADE,
  progress        INTEGER     NOT NULL DEFAULT 0,
  unlocked        BOOLEAN     NOT NULL DEFAULT false,
  unlocked_at     TIMESTAMPTZ,
  -- Backs the ON CONFLICT (user_id, achievement_key) upsert in check_and_unlock.
  CONSTRAINT user_achievements_user_id_achievement_key_key UNIQUE (user_id, achievement_key)
);

-- Definitions for every key /achievements/check computes progress for.
-- Without these rows the badge screen renders empty and no achievement
-- can ever unlock. Icons stay NULL — the client renders its own art.
INSERT INTO achievements (key, title, description, icon, category, threshold) VALUES
  ('first_save',         'First Word',        'Save your first word',                    NULL, 'collection', 1),
  ('word_collector_10',  'Word Collector',    'Save 10 words',                           NULL, 'collection', 10),
  ('word_collector_50',  'Word Hoarder',      'Save 50 words',                           NULL, 'collection', 50),
  ('word_collector_100', 'Lexicon Builder',   'Save 100 words',                          NULL, 'collection', 100),
  ('word_collector_500', 'Walking Dictionary','Save 500 words',                          NULL, 'collection', 500),
  ('first_review',       'First Review',      'Complete your first review',              NULL, 'review',     1),
  ('review_10',          'Reviewer',          'Complete 10 reviews',                     NULL, 'review',     10),
  ('review_50',          'Review Regular',    'Complete 50 reviews',                     NULL, 'review',     50),
  ('streak_3',           'Warming Up',        'Reach a 3-day streak',                    NULL, 'streak',     3),
  ('streak_7',           'One Week Strong',   'Reach a 7-day streak',                    NULL, 'streak',     7),
  ('streak_30',          'Monthly Devotion',  'Reach a 30-day streak',                   NULL, 'streak',     30),
  ('streak_100',         'Centurion',         'Reach a 100-day streak',                  NULL, 'streak',     100),
  ('movies_5',           'Film Buff',         'Study words from 5 movies',               NULL, 'movies',     5),
  ('movies_20',          'Cinephile',         'Study words from 20 movies',              NULL, 'movies',     20),
  ('mastered_10',        'Rising Master',     'Master 10 words',                         NULL, 'mastery',    10),
  ('mastered_50',        'Word Master',       'Master 50 words',                         NULL, 'mastery',    50),
  ('retention_90',       'Sharp Memory',      '90%+ accuracy across 20+ reviews',        NULL, 'mastery',    1)
ON CONFLICT (key) DO NOTHING;

-- ── Family plan ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS family_plans (
  id          SERIAL      PRIMARY KEY,
  -- One plan per owner — /family/plan assumes a single row per user.
  owner_id    INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_members INTEGER     NOT NULL DEFAULT 5,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT family_plans_owner_id_key UNIQUE (owner_id)
);

CREATE TABLE IF NOT EXISTS family_members (
  id        SERIAL      PRIMARY KEY,
  plan_id   INTEGER     NOT NULL REFERENCES family_plans(id) ON DELETE CASCADE,
  user_id   INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT family_members_plan_id_user_id_key UNIQUE (plan_id, user_id)
);

-- ── Student discount ────────────────────────────────────────────────────
-- Matches the shape the routes used to create lazily at request time, so
-- environments that already have it are untouched by IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS student_verifications (
  id          SERIAL       PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       VARCHAR(255),
  method      VARCHAR(20)  NOT NULL,
  verified    BOOLEAN      DEFAULT false,
  verified_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  CONSTRAINT student_verifications_user_id_method_key UNIQUE (user_id, method)
);

COMMIT;

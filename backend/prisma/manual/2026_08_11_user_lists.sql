-- Lists tab — generic user-owned lists of films or words.
--
-- A list holds films OR words, never both (`kind`). That constraint is what
-- lets the index row honestly preview its contents and what keeps the
-- Practice handoff unambiguous.
--
-- Two lists are pinned per user and cannot be renamed or deleted:
--   system_key='reel'       (films) — "Saved from Home", the Home + button
--   system_key='favourites' (words) — "Favourites", the Explore heart
--
-- IMPORTANT — the pinned lists are ADAPTERS, not storage. Their `user_lists`
-- row exists so the index can render them, but their MEMBERS live elsewhere:
--   reel       -> user_reel_movies      (unchanged; Home + / PosterFlight)
--   favourites -> user_words WHERE movie_id IS NULL AND is_learned = false
-- so `user_list_films` / `user_list_words` below only ever hold members of
-- USER-CREATED lists. See services/lists.py — nothing outside that module may
-- assume list.id tells you where the rows are.
--
-- NOT wrapped in BEGIN/COMMIT: this file contains `ALTER TYPE ... ADD VALUE`,
-- whose new labels are unusable by later statements in the same transaction
-- (manual/README.md rule 4). Every statement is individually idempotent
-- (rule 2), so a partial run is safe to replay.
--
-- APPLY AS THE APPLICATION'S DB ROLE. New tables are owned by whoever runs
-- the CREATE, and the API only has rights on tables its own role owns — apply
-- this as a superuser and every /lists request 500s with "permission denied
-- for table user_lists". `railway connect Postgres` already connects as that
-- role, so the documented path is correct; a local psql run as your own
-- superuser is not, and needs
--   ALTER TABLE user_lists, user_list_films, user_list_words OWNER TO <role>;
--   ALTER TYPE listkind OWNER TO <role>;
--   ALTER SEQUENCE user_lists_id_seq OWNER TO <role>;
-- afterwards. No role name is hardcoded here so the file stays portable
-- between local and Railway.

-- ── listkind ───────────────────────────────────────────────────────────────
-- No CREATE TYPE IF NOT EXISTS in Postgres; guard by catalog lookup.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'listkind') THEN
    CREATE TYPE listkind AS ENUM ('films', 'words');
  END IF;
END
$$;

-- ── user_lists ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_lists (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(60) NOT NULL,
  kind        listkind    NOT NULL,
  -- 'reel' | 'favourites' | NULL. Non-null rows are the pinned lists:
  -- undeletable, unrenameable, created lazily by ensure_system_lists().
  system_key  VARCHAR(20),
  position    INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive name uniqueness per user, so "Film noir" and "film noir"
-- cannot both exist and confuse the Add-to-list sheet.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_lists_user_name
  ON user_lists (user_id, lower(name));
-- Makes ensure_system_lists()'s ON CONFLICT DO NOTHING race-safe: two
-- concurrent first-opens can both miss the SELECT, and the loser is caught
-- here rather than creating a second "Favourites".
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_lists_user_system
  ON user_lists (user_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_user_lists_user_kind
  ON user_lists (user_id, kind, position);

-- ── user_list_films ────────────────────────────────────────────────────────
-- Films are denormalised exactly like user_reel_movies, for the same reason:
-- the index renders poster fans with no TMDB roundtrip.
CREATE TABLE IF NOT EXISTS user_list_films (
  list_id     BIGINT      NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  tmdb_id     INTEGER     NOT NULL,
  position    INTEGER     NOT NULL,
  title       VARCHAR     NOT NULL,
  poster_path VARCHAR,
  year        INTEGER,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, tmdb_id)
);
CREATE INDEX IF NOT EXISTS ix_user_list_films_list_added
  ON user_list_films (list_id, added_at DESC);

-- ── user_list_words ────────────────────────────────────────────────────────
-- Words are keyed by the same lowercased `word` string user_words uses — NOT
-- by lemma_id — so membership joins straight onto the SRS table. lemma_id is
-- an optional enrichment for CEFR / part-of-speech display, and is nulled
-- rather than cascading if a lemma is ever retired.
CREATE TABLE IF NOT EXISTS user_list_words (
  list_id  BIGINT      NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  word     VARCHAR     NOT NULL,
  lemma_id INTEGER     REFERENCES lemmas(id) ON DELETE SET NULL,
  position INTEGER     NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, word)
);
CREATE INDEX IF NOT EXISTS ix_user_list_words_list_added
  ON user_list_words (list_id, added_at DESC);

-- ── interaction analytics ──────────────────────────────────────────────────
-- Must run outside a transaction (see header). IF NOT EXISTS makes the replay
-- a no-op on an already-migrated database.
ALTER TYPE interactiontype ADD VALUE IF NOT EXISTS 'LIST_ADD';
ALTER TYPE interactiontype ADD VALUE IF NOT EXISTS 'LIST_REMOVE';

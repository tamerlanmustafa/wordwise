-- Issue #115 — the home card's add-to-list glyph has no colour to reason about.
--
-- The glyph sits in the card's trailing top corner, over the part of the
-- backdrop the scrim covers least, so the fixed gold it uses today vanishes on
-- roughly a third of real stills. The client has shipped the contrast maths
-- since the card rebuild (apps/mobile/src/components/home/cardVisuals.ts:
-- pickPlusInk / contrastRatio / compositeOver / parseCornerRgb) and reads
-- `movie.backdrop_corner_rgb` off every feed row. Nothing has ever put a value
-- there: `movies` carries no backdrop field at all, and `backdrop_path` is
-- fetched per page from TMDB by the client.
--
-- This column is that value: the average colour of the backdrop's top 26% x
-- trailing 20% patch, computed once by src/services/backdrop_ink.py.
--
-- Why one integer and not int[]
-- -----------------------------
-- The value is packed as `r << 16 | g << 8 | b`, so 0..16777215 — a quarter of
-- int4's range. The wire format the client sees is still `[r, g, b]`;
-- `backdrop_ink.unpack_rgb` is the single place the two representations meet.
--
-- `int[]` reads better in psql and that is its entire case. Against it:
-- /movies/by-cefr is a query_raw statement, and how the Prisma query engine
-- serializes a Postgres array back through that path is untested here — the
-- same handler already has to `json.loads` its JSONB column defensively
-- because raw-query scalars come back inconsistently typed. An integer has one
-- representation.
--
-- NULL is a supported state, not a gap
-- ------------------------------------
-- A movie with no TMDB backdrop, a retired still, or an image Pillow cannot
-- decode stores nothing. The client already falls back to gold + a
-- counter-coloured halo when the field is absent, which is exactly what every
-- card renders today. Nothing invents a colour.
--
-- No index. There is no predicate on this column anywhere: /by-cefr selects it
-- in the projection and the backfill scans for NULLs once. An index would be
-- write amplification bought for a query that does not exist.
--
-- Additive, so the normal ordering applies (prisma/manual/README.md rule 3):
-- run this BEFORE merging the code. The deployed Prisma client does not select
-- columns it has not been regenerated for, but the new /by-cefr projection
-- names this column explicitly and would 500 against a database without it.
--
--   railway connect Postgres        # or: psql "$DATABASE_PUBLIC_URL"
--   \i backend/prisma/manual/2026_08_26_add_backdrop_corner_rgb_issue_115.sql
--
-- Idempotent: IF NOT EXISTS, no DEFAULT, so on PostgreSQL 11+ this is a
-- catalog-only change — no table rewrite and no lock held while 4,585 rows are
-- touched.

ALTER TABLE movies
    ADD COLUMN IF NOT EXISTS backdrop_corner_rgb integer;

COMMENT ON COLUMN movies.backdrop_corner_rgb IS
    'Issue #115: average colour of the TMDB backdrop''s top 26% x trailing 20% '
    'patch, packed as r<<16 | g<<8 | b. The home card picks its add-glyph ink '
    'by WCAG contrast against this. NULL means no usable backdrop; the client '
    'falls back to gold + halo. Written by backfill_backdrop_corner_rgb.py and '
    'by script ingestion for newly added movies.';

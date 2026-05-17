# Journey Reel — How It Works

The Reel is WordWise's daily-check-in vocabulary surface. Each tile is one movie; tapping the active tile opens a 5-word, ~2-minute quiz drawn from that movie's subtitle vocabulary. The daily goal is 3 tiles (~6 minutes). The reel is a **vocab teacher dressed as a filmstrip** — the app never plays film footage.

This document is the source-of-truth on how the reel actually behaves today and what the gaps are. It is deliberately scoped to the reel + the screens it owns (`JourneyScreen`, `SetIntroScreen`, `QuizLessonScreen`, `QuizResultScreen`, the reel store, the daily-goal store, the `/reel` and `/quiz/journey/sessions` routes).

---

## 1. Free vs. Premium access

**Today (factual state of the code):** there is **no premium gating on the reel anywhere**.

- [`backend/src/routes/reel.py`](../backend/src/routes/reel.py) authenticates via `get_current_active_user` but never reads `users.subscription_tier`.
- [`apps/mobile/src/stores/reelStore.ts`](../apps/mobile/src/stores/reelStore.ts), [`JourneyScreen.tsx`](../apps/mobile/src/components/JourneyScreen.tsx), [`SetIntroScreen.tsx`](../apps/mobile/src/components/SetIntroScreen.tsx), [`QuizLessonScreen.tsx`](../apps/mobile/src/components/QuizLessonScreen.tsx) never read the `entitlementsStore` or check `user.subscription_tier`.
- The only paywall in the app today is on the SRS Today's-Word preview ([`App.tsx`](../apps/mobile/src/core/App.tsx) → `paywallProps`), which is a separate surface.

So a free user and a premium user today see **identical** reels, with identical add-movie ability, identical session vocab, identical daily-goal behavior, and identical streak rewards.

**Recommended split** (not implemented; see §4):

| Capability                                                  | Free                                  | Premium                                |
| ----------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| View the reel                                               | ✅                                    | ✅                                     |
| Daily 3-set goal + streak                                   | ✅                                    | ✅                                     |
| Active-tile quiz (movie-specific words)                     | ✅                                    | ✅                                     |
| Suggested zone size                                         | First N suggested tiles only          | Full ranked feed                       |
| User-pick capacity (＋ Add a film)                          | Cap (e.g. 3 simultaneously active)    | Unlimited                              |
| SRS reintroduction during journey sessions                  | ✅                                    | ✅                                     |
| Streak freezes (skip a day, keep streak)                    | ❌                                    | ✅ (1–2 per month)                     |
| Bonus tiles after daily-3 wall                              | Capped (e.g. 1 bonus/day)             | Unlimited                              |
| Per-movie progress / replay completed tiles                 | ✅ for last N                         | ✅ unlimited                           |
| Cross-device sync of `completedCount` + streak              | ❌ (device-local AsyncStorage today)  | ✅ (backend mirror)                    |

The cleanest paywall lever is the **＋ Add a film** tile, because adding is the only optional action — suggested-zone progression works without it. The user has explicitly requested that adding stays free in the current implementation; if you later need a gate, gate at the **count of simultaneously-active user picks**, not at the action itself.

---

## 2. User story — what happens after they tap the Reel tab

Concrete walkthrough using the code paths actually wired today.

### 2.1 Landing on the reel

1. Tab tap → `App.tsx` sets `currentScreen = 'journey'`.
2. [`JourneyScreen`](../apps/mobile/src/components/JourneyScreen.tsx) mounts:
   - Hydrates `reelStore` if not already (`GET /reel?cursor=0&limit=60`).
   - Reads `useDailyGoalStore` (auto-rolls `done` to 0 if it's a new local day).
   - Reads `journeyCompletedCount` from `App.tsx` state (which was hydrated from `AsyncStorage['journey.completedCount']`).
3. The ScrollView mounts with `contentOffset = scrollableHeight - WINDOW_HEIGHT` — i.e. **scrolled to the bottom** on first paint. The user sees, from bottom to top: ＋ Add a film → tile 1 (active) → tile 2 → tile 3 → tile 4 → tile 5 …
4. The viewport-anchored **daily-goal strip** at the top shows `{done} of 3 · ~2 min each · 🔥 {streak}`. Pips fill gold to the left as the day progresses.

### 2.2 The reel composition

Tile order is bottom-up. The backend returns two zones concatenated:

| Zone           | Order                                  | Source                                                              |
| -------------- | -------------------------------------- | ------------------------------------------------------------------- |
| **User picks** | Most-recently-added first              | `user_reel_movies` for this user, `ORDER BY added_at DESC`          |
| **Suggested**  | Highest new-lemma-yield first          | Curated `SUGGESTED_SEED` (per-CEFR), re-ranked by yield (see §3.4)  |

User picks carry a ★ corner stamp; suggested do not. The number badge always shows queue position (`idx + 1`). At the seam between zones a subtle **splice-tape** detail spans horizontally, and two opaque chips label the zones ("SUGGESTED ▲ {level} ±1" above, "★ YOUR PICKS · {n} added" below).

### 2.3 Tile state machine

Derived at render time from `completedCount` + `VISIBLE_AHEAD = 3` ([`JourneyScreen.tsx`](../apps/mobile/src/components/JourneyScreen.tsx)):

```
idx <  completedCount                    → completed (gold border, ✓ stamp, opacity 0.55 poster)
idx == completedCount                    → active    (CEFR halo, 92×92, poster full)
idx <= completedCount + VISIBLE_AHEAD    → inactive  (60×60, poster full, not tappable)
otherwise                                → locked    (54×54, poster dimmed to 0.28 + dark wash)
```

Only the **active** tile responds to taps. The connector line between tiles is solid gold for completed segments AND for any segment where both endpoints are user picks; otherwise dashed white-18%.

### 2.4 Tapping the active tile

1. `handleTilePress(i)` calls `quizApi.startJourneySession(level, i, 5, tmdb_id)`.
2. [`backend/src/routes/quiz.py`](../backend/src/routes/quiz.py) → `start_journey_session`:
   - Pulls **SRS-due** lemmas from `user_words` (max 2 reintroductions per session).
   - Fills the remainder with the movie's top-frequency **unknown** lemmas in the user's CEFR ±1 band, joining `movies` → `movie_lemma_mappings` → `lemmas`, excluding anything already in `user_words` and `hidden_words`.
   - If `tmdb_id` is null or the movie has no mapping data, falls back to the legacy offset-based cross-movie query.
   - Translates each word via `_translate_words`, builds card payloads, creates a `quiz_sessions` row tagged `kind='journey'` with `movie_id` set when known.
3. Response carries `{ session_id, cards: [{ word, card_type: 'type', translation }] }`.
4. App stashes the response in `setIntroData` and routes to `setIntro`.

### 2.5 Set Intro

[`SetIntroScreen`](../apps/mobile/src/components/SetIntroScreen.tsx) previews:

- Blurred poster as the hero backdrop (no separate fetch — same TMDB path the tile used).
- Source-film card with title + CEFR pill.
- Strap: "PRE-WATCH VOCAB · Learn 5 words from this film · ~2 min".
- 5 word rows with index disc, word in serif, `{N} letters · rank {N}`, "NEW" or "↻ Review" tag.
- Primary CTA: **"Start learning →"** (gold pill, pulses for 10s).

User can either tap back (cancels the session, no record bumped) or Start.

### 2.6 Quiz

[`QuizLessonScreen`](../apps/mobile/src/components/QuizLessonScreen.tsx) runs the 5 cards:

- Progress bar at top, `{idx+1}/{total}` counter, ✕ exit.
- Each card has `card_type = 'type'`: shows the target word in a CEFR-colored frame, user types the translation, system normalizes (strips accents, punctuation, lowercases) and grades.
- On submit, the result accumulates in local `results: QuizCardResultInput[]`.
- After card 5, `submitCards` POSTs the batch, then `completeSession` returns `{ stars, xp_earned, correct_count, total_scored }`.
- `onComplete(result, level, results)` fires, passing **per-card results** up to the parent so the result screen can render the recap.

There are **no lives/hearts**; getting a card wrong does not abort the session.

### 2.7 Result + the daily-3 wall

In [`App.tsx`](../apps/mobile/src/core/App.tsx) `handleQuizComplete`:

1. Persists `journey.completedCount = max(prev, completedTileIdx + 1)` to AsyncStorage.
2. Calls `useDailyGoalStore.getState().bump()` — increments today's `done`, updates streak if this is the 3rd set of the day (streak continues if `lastHitDate == yesterday`, resets to 1 otherwise), persists `journey.dailyGoal.v1`.
3. Snapshots `{ completedTileIdx, dailyDone, dailyStreak, justHit3, cardResults, upNext }` so the result screen reads post-bump values.
4. Computes `upNext` from `reelStore.tiles[completedTileIdx + 1]`.

[`QuizResultScreen`](../apps/mobile/src/components/QuizResultScreen.tsx) in journey mode shows:

- `{correct} of {total} correct` headline + `{accuracy}% · +{xp} XP`.
- 🔥 streak ticker (`+1 today!` when `justHit3`).
- Gold daily-goal pips (`{n} / 3`).
- Per-word ✓/× recap.
- **Up-next teaser**: poster + title of tile N+1.
- Primary CTA: **"Next set →"** → starts session for tile N+1 and routes directly to its Set Intro (the chain that makes the daily-3 feel achievable).

When `justHit3 === true`, the Up-next teaser is replaced by a **wall card**:

> **Today's done.**
> Come back tomorrow for tile {nextIdx}, or do an extra one for bonus XP.

CTAs flip to **"Stop for today"** (primary, gold) and **"+1 bonus tile"** (secondary). Bonus tiles still bump `completedCount` but don't double-bump the streak/pips.

### 2.8 How the user actually learns

Per session: 5 movie-specific words → typed translation → instant feedback → recap. Per day: 3 sessions = 15 words seen, ~2 of which are SRS reintroductions of past misses, ~13 of which are new. Across days: missed words bubble into future sessions via `user_words.srs_due_at`, while the tile path advances linearly with `completedCount`. The user picks build a personal queue at the bottom; the suggested zone keeps the reel populated above and adapts to what the user already knows via the new-lemma-yield ranking.

The film is purely flavor — a memory hook tying each set of 5 words to a familiar story. The expectation is that the user later watches the film (outside the app) with the vocab already learned.

---

## 3. Database structure

Only tables actually queried or written by the reel learning logic.

### 3.1 `user_reel_movies` (the reel itself)

The user's curated picks. Suggested tiles are not persisted — they're computed per-request.

```
user_id      INTEGER     NOT NULL  FK → users(id) ON DELETE CASCADE
tmdb_id      INTEGER     NOT NULL
position     INTEGER     NOT NULL
title        VARCHAR     NOT NULL           -- denormalized from TMDB
poster_path  VARCHAR                        -- denormalized
year         INTEGER
added_at     TIMESTAMPTZ NOT NULL DEFAULT now()
PRIMARY KEY  (user_id, tmdb_id)
UNIQUE       (user_id, position)            -- ux_user_reel_movies_user_position
INDEX        (user_id, added_at)            -- ix_user_reel_movies_user_added_at
```

Why denormalized: avoids a per-row TMDB roundtrip when rendering the reel. Why `tmdb_id` keyed (not the internal `movies.id`): users can add any film TMDB knows about, including titles we haven't ingested.

Read path: `GET /reel` orders by `added_at DESC` so newest pick is tile 0 (bottom of reel, closest to the user).

### 3.2 `movies` (canonical film records)

Used as the bridge between a `tmdb_id` and the lemma graph. The reel only reads three columns:

```
id                INTEGER  PK
tmdb_id           INTEGER  UNIQUE         -- the join key from user_reel_movies and suggested seed
title             VARCHAR
difficulty_level  proficiencylevel ENUM    -- NOT a CEFR code; the reel doesn't filter on this directly
```

`difficulty_level` is the legacy enum (`ELEMENTARY`/`INTERMEDIATE`/`ADVANCED`) and the reel ignores it — band filtering happens at the lemma level via `lemmas.cefr_level`.

### 3.3 `lemmas` (vocab units)

```
id                INTEGER  PK
lemma             VARCHAR  UNIQUE
cefr_level        proficiencylevel  NOT NULL     -- A1..C2; this is what the reel filters on
frequency_rank    INTEGER                        -- global frequency, used as a tiebreaker
... (other fields ignored by the reel)
```

Indexes used by the reel: `ix_lemmas_cefr_level`, `ix_lemmas_frequency_rank`.

### 3.4 `movie_lemma_mappings` (the join that makes the reel adaptive)

```
id                  INTEGER  PK
movie_id            INTEGER  FK → movies(id)         -- ix_movie_lemma_mapping_movie_id
lemma_id            INTEGER  FK → lemmas(id)         -- ix_movie_lemma_mapping_lemma_id
frequency_in_movie  INTEGER  NOT NULL DEFAULT 1      -- how often this lemma appears in this movie's subtitles
UNIQUE (movie_id, lemma_id)
```

This is the single most important table for the reel's learning logic. It powers two queries:

1. **Movie-specific session vocab** (`_movie_specific_words` in `quiz.py`):
   ```sql
   SELECT l.lemma
   FROM movie_lemma_mappings mlm
   JOIN movies m  ON m.id = mlm.movie_id
   JOIN lemmas l  ON l.id = mlm.lemma_id
   WHERE m.tmdb_id = $1
     AND l.cefr_level::text IN (user's CEFR ±1 band)
     AND NOT EXISTS (SELECT 1 FROM user_words WHERE LOWER(word) = LOWER(l.lemma))
   ORDER BY mlm.frequency_in_movie DESC, l.frequency_rank ASC NULLS LAST
   LIMIT 5;
   ```
   → "the 5 most common unknown words in this movie at your level."

2. **Suggested-zone ranking** (`_suggested_for_level` + the yield query in `reel.py`):
   ```sql
   SELECT m.tmdb_id, COUNT(DISTINCT mlm.lemma_id) AS yield
   FROM movie_lemma_mappings mlm
   JOIN movies m  ON m.id = mlm.movie_id
   JOIN lemmas l  ON l.id = mlm.lemma_id
   WHERE m.tmdb_id = ANY($1)
     AND l.cefr_level::text = ANY($2)              -- user's CEFR ±1 band
     AND NOT EXISTS (SELECT 1 FROM user_words WHERE LOWER(word) = LOWER(l.lemma))
   GROUP BY m.tmdb_id;
   ```
   → "how many new at-level words would this movie teach you?" Stable-sorted DESC then by curated order.

### 3.5 `user_words` (known vocab + SRS state)

```
id                    INTEGER PK
user_id               INTEGER FK → users(id) ON DELETE CASCADE
word                  VARCHAR NOT NULL                  -- the lemma string (lowercased on compare)
movie_id              INTEGER FK → movies(id)           -- which movie this was learned from (nullable)
is_learned            BOOLEAN NOT NULL DEFAULT false    -- "graduated" flag
created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
srs_box               INTEGER NOT NULL DEFAULT 1        -- Leitner box; higher = further-spaced
srs_due_at            TIMESTAMPTZ NOT NULL DEFAULT now()
srs_last_reviewed_at  TIMESTAMPTZ
UNIQUE (user_id, word, movie_id)
INDEX  (user_id, srs_due_at)   -- ix_user_words_user_due — powers the SRS-due lookup
```

The reel reads this in two places:

- **SRS reintroductions in next session.** First 2 slots of any journey session come from `user_words` where `is_learned = false AND srs_due_at <= NOW()`, ordered most-overdue first.
- **Dedup for new-word selection.** Both `_movie_specific_words` and the suggested-yield query exclude lemmas the user already has in `user_words` (regardless of box), so the same word never re-appears as "new."

### 3.6 `quiz_sessions` (one row per started session)

```
id              SERIAL PK
user_id         INTEGER FK → users(id)
movie_id        INTEGER         -- set when journey session is bound to a movie (NEW behavior post-#2)
cefr_level      VARCHAR(2)      -- the user's level at start
kind            VARCHAR(16)     -- 'unit' | 'pre_movie' | 'batch' | 'journey'
started_at      TIMESTAMPTZ NOT NULL DEFAULT now()
completed_at    TIMESTAMPTZ                -- NULL until completeSession runs
stars           INTEGER
correct_count   INTEGER NOT NULL DEFAULT 0
total_scored    INTEGER NOT NULL DEFAULT 0
INDEX (user_id, movie_id, cefr_level)
```

`kind = 'journey'` means a reel session. `movie_id` lets you later query "which films has this user worked through" — important for per-movie progress that the reel UI doesn't surface yet.

### 3.7 `quiz_card_results` (per-card outcomes)

```
id           SERIAL PK
session_id   INTEGER FK → quiz_sessions(id) ON DELETE CASCADE
word         VARCHAR NOT NULL                  -- the target word, lowercase on compare
card_type    VARCHAR(16)                       -- 'type' (always, for reel) | 'self_rate'
is_correct   BOOLEAN                           -- null for self_rate cards
self_rating  VARCHAR(8)                        -- 'know' | 'kinda' | 'dont' (unused in reel)
answer_ms    INTEGER NOT NULL
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
INDEX (session_id)
INDEX (word)
```

Used today only to compute the session's correct/total roll-up. **Not yet** wired into `user_words.srs_box` updates — see §4.

### 3.8 `user_quiz_stats` (rolled-up stats per user)

```
user_id          INTEGER PK FK → users(id)
total_stars      INTEGER NOT NULL DEFAULT 0
total_sessions   INTEGER NOT NULL DEFAULT 0
avg_accuracy     DOUBLE PRECISION NOT NULL DEFAULT 0
retention_score  DOUBLE PRECISION NOT NULL DEFAULT 0
xp               INTEGER NOT NULL DEFAULT 0
last_active_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

Written by `completeSession`. The reel itself doesn't read this (the leaderboard does), but it's part of the loop's persistence story.

### 3.9 `users` (subscription columns the reel could read but doesn't)

```
id                       INTEGER PK
proficiency_level        proficiencylevel ENUM     -- A1..C2; the reel reads this for band filtering
subscription_tier        subscriptiontier ENUM     -- 'free' | 'plus' | ...  → currently UNUSED by reel
subscription_expires_at  TIMESTAMPTZ               -- UNUSED by reel
ads_eligible             BOOLEAN                   -- UNUSED by reel
srs_free_previews_used   INTEGER                   -- used by SRS Today's-Word, NOT reel
```

`proficiency_level` is the only column the reel actually reads. The subscription columns exist and are populated; the reel just doesn't gate on them yet.

### 3.10 Device-local state (AsyncStorage, not DB)

This is where the day-to-day reel state actually lives today:

| Key                            | Type    | Purpose                                                          |
| ------------------------------ | ------- | ---------------------------------------------------------------- |
| `journey.completedCount`       | string  | "How many reel tiles I've completed total."                      |
| `journey.dailyGoal.v1`         | JSON    | `{ date, done, streak, lastHitDate }` — the daily counter        |
| `journey.plusTooltipSeen`      | "1"     | Whether to show the first-launch ＋-tile tooltip                 |

None of these are mirrored to the backend. This is the single biggest structural gap (see §4).

---

## 4. Suggestions (authentic, no hedging)

Ordered by impact on the "daily vocab habit" intent. Items with "TRIVIAL" are <1 hour. "MEDIUM" is half a day. "LARGE" is multi-day.

### 4.1 Mirror `completedCount` + daily state to the server [LARGE, blocks 4.2 and 4.3]

Today, `journey.completedCount` and `journey.dailyGoal.v1` live in AsyncStorage. A reinstall wipes them; a second device sees a different reel. Streaks are structurally fragile (the only signal is `users.srs_last_session_date` which the reel doesn't use). This is the load-bearing limitation behind every other item in this list.

Concrete: add a `user_journey_progress` table (`user_id` PK, `completed_count`, `last_completed_at`, `daily_done`, `daily_date`, `streak`, `last_hit_date`), POST on session complete from the client, GET on hydrate. Keep AsyncStorage as a local cache.

### 4.2 Movie-bound completion + per-movie progress [MEDIUM]

`quiz_sessions.movie_id` is now populated when a journey session is bound to a movie (post-#2 fix), but the reel UI doesn't surface it. The user can't see "I've already done this Inception tile, replay it?" because tile completion is keyed on global `completedCount`, not on the movie. Use `unit_progress` (already exists) to store per-(user, movie, cefr_level) best stars and let the user replay completed tiles for SRS reinforcement without bumping `completedCount`.

### 4.3 SRS box updates from `quiz_card_results` [MEDIUM, blocks real SRS]

Right now `quiz_card_results.is_correct` is recorded but never feeds back into `user_words.srs_box` or `srs_due_at`. The "SRS reintroduction" at the start of each session only works for words the user added through the *other* SRS surface (the Today's-Word flow). The reel-only learner builds no SRS state at all.

Concrete: on `submitCards`, for each `(word, is_correct)` either insert a new `user_words` row with `srs_box = is_correct ? 2 : 1` and `srs_due_at = NOW() + (box-based interval)`, or update the existing row's box (`+1` on correct, reset to 1 on miss). This closes the loop.

### 4.4 Replace the hardcoded `SUGGESTED_SEED` with a real query [MEDIUM]

The 48-movie seed in `reel.py` is a curated list with literal TMDB ids and poster paths. It rots (TMDB changes poster paths over time), can't grow, and constrains the candidate pool to whatever I hand-picked. The yield ranking I added only re-orders these 48 — the *candidate set* is still a manifest.

Concrete: replace `_suggested_for_level` with a SQL query that pulls candidate `movie_id`s directly from `movie_lemma_mappings` with a JOIN to `movies` (filter to English originals via a runtime check on `movies.script_text` presence), then ranks them by the same yield formula. Cache poster paths via a `movies.poster_path` column we backfill from TMDB once. Goal: the suggestion pool is the entire ingested catalog, ranked.

### 4.5 The reel needs to tell the user WHY a movie is suggested [TRIVIAL→MEDIUM]

A suggested tile today is indistinguishable from a user pick (other than the ★). The user has no idea "Parasite was suggested because it has 23 new B2 words for you." Surface the yield count on the SUGGESTED chip or as a tiny corner stamp on the tile: "+23 new". This makes the ranking visible and turns the algorithm into a value prop.

### 4.6 Streak freezes for premium [MEDIUM, requires §4.1]

The current streak math (in `dailyGoalStore.bump`) resets to 1 on the first day the user fails to hit 3, with no buffer. This is the standard retention killer: motivated users go on vacation, lose their 23-day streak, and stop opening the app. Add a `streak_freezes_remaining` field to the (server-side) daily state; on day-roll, consume one freeze instead of resetting the streak. Premium gets 2/month, free gets 0. This is the highest-impact paywall lever for a daily-habit app.

### 4.7 Pick the user's TARGET band, not just their CURRENT band [MEDIUM]

Today both queries (`_movie_specific_words` and the suggested-yield ranking) filter to the user's CEFR ±1. That means an A1 user only ever sees A1+A2 vocab, and B2 sees A2+B1+B2. The user never learns *upward* — their level can't grow inside the reel because the reel won't ever surface a B1 word to an A1 user.

Concrete: weight the band asymmetrically. e.g. B2 user → 30% from B1 (review), 50% from B2 (level), 20% from C1 (stretch). The stretch slot is what makes the reel a teacher rather than a maintainer. Today the reel maintains; it does not teach upward.

### 4.8 Mix card types beyond `card_type = 'type'` [MEDIUM]

Every reel card is typed translation. That's one modality. Learners plateau on a single modality faster than on a varied diet. Existing `card_type` infrastructure already supports `'self_rate'` — add an MCQ type, an audio-pronunciation type (once TTS is wired), and a fill-in-context type using `sentence_bank`. Distribute across the 5 cards so each session is mixed.

### 4.9 No deletion UX for user picks [TRIVIAL]

Per the spec, deletion should be allowed on `source: 'user'` tiles in `inactive` or `locked` state via long-press → confirm sheet (`Alert.alert` is fine). Not implemented. Without it, a user who tests-added a movie they don't care about has no way to remove it. Backend route `DELETE /reel/{tmdb_id}` exists.

### 4.10 Walked-back spec: locked tiles now show dimmed posters [LIGHT — but worth re-deciding]

In the last session you asked to show dimmed posters on locked tiles instead of the flat dark fill the spec called for. That was the right ergonomic call (you wanted to see all 21 of your picks), but it weakens the "you haven't earned this yet" gating intent. Two consistent endpoints:

- **Treat the reel as a watchlist/queue** → dimmed posters are correct; the lock is purely about quiz tap-ability, not visual access. Document that explicitly.
- **Treat the reel as gated progression** → revert to flat-dark and add a separate "library" screen where the user *can* browse their picks visually without the quiz gating.

The product can't be both. Pick one before adding more UX on top.

### 4.11 ＋ Add a film tile is wide open [LIGHT]

Today any user can add unlimited films via TMDB search. If we want monetization without breaking the user picks promise (you explicitly said adding stays free), gate on the **count of unfinished user picks** — e.g. free users can have 3 active picks in flight; to add a 4th, finish or remove one. Premium = unlimited. This preserves the "you can always add" mental model while creating differentiation.

### 4.12 The 5-words promise is unenforced [TRIVIAL]

`quizApi.startJourneySession(level, i, 5, tmdb_id)` passes `words_per_tile: 5` but the lesson screen renders `{idx+1}/{total}` from whatever the session returns. If the backend ever returns 3 or 7 (e.g. movie has only 3 unknown at-level lemmas), the UI silently shows that count. Either backfill from the global frequency list to *guarantee* 5, or surface "3 of 3" honestly. Today it's silent.

### 4.13 No "today only" enforcement after the wall [LIGHT]

The wall modal is a soft suggestion — "Stop for today" is the primary CTA but the user can still tap "+1 bonus tile" and chain indefinitely. Some products (Duolingo) actually disable practice past the daily goal to *strengthen* the come-back-tomorrow signal. Worth considering if retention dips for power users. The current "bonus is unlimited" stance bets that motivated users won't binge; that's an unproven assumption.

### 4.14 The "Up next" preview leaks the next movie's title [LIGHT]

The result screen's Up-next teaser shows tile N+1's poster + title. That's a great chaining mechanic — but it also lets the user "scout ahead" by repeatedly completing → reading → backing out (if they could). Today they can't back out (the only CTA chain forward), but if you ever add a "Done" path before "Next set →", be aware this becomes a leak. Minor.

### 4.15 Day-roll uses device local time [LIGHT, but a real edge case]

`dailyGoalStore.todayLocal()` reads the device's local date. A user flying east → west crosses midnight twice in one calendar day; flying west → east loses a day. Either accept the small inaccuracy (most users don't fly daily) or move day-roll to the server. The latter is correct, the former is fine.

---

## File map (where each piece lives)

| Concern                                | File                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Reel screen + zigzag layout            | [`apps/mobile/src/components/JourneyScreen.tsx`](../apps/mobile/src/components/JourneyScreen.tsx)            |
| Single tile rendering                  | [`apps/mobile/src/components/journey/MovieTile.tsx`](../apps/mobile/src/components/journey/MovieTile.tsx)    |
| Connector lines                        | [`apps/mobile/src/components/journey/JourneyConnector.tsx`](../apps/mobile/src/components/journey/JourneyConnector.tsx) |
| Film-stock background                  | [`apps/mobile/src/components/journey/JourneyReelBackground.tsx`](../apps/mobile/src/components/journey/JourneyReelBackground.tsx) |
| Sprockets (scroll-with-content)        | [`apps/mobile/src/components/journey/JourneyReelSprockets.tsx`](../apps/mobile/src/components/journey/JourneyReelSprockets.tsx) |
| Set Intro screen                       | [`apps/mobile/src/components/SetIntroScreen.tsx`](../apps/mobile/src/components/SetIntroScreen.tsx)          |
| Quiz lesson (5 cards)                  | [`apps/mobile/src/components/QuizLessonScreen.tsx`](../apps/mobile/src/components/QuizLessonScreen.tsx)      |
| Result screen + daily wall             | [`apps/mobile/src/components/QuizResultScreen.tsx`](../apps/mobile/src/components/QuizResultScreen.tsx)      |
| Reel state (combined user + suggested) | [`apps/mobile/src/stores/reelStore.ts`](../apps/mobile/src/stores/reelStore.ts)                              |
| Daily goal + streak state              | [`apps/mobile/src/stores/dailyGoalStore.ts`](../apps/mobile/src/stores/dailyGoalStore.ts)                    |
| App-level navigation + persistence     | [`apps/mobile/src/core/App.tsx`](../apps/mobile/src/core/App.tsx)                                            |
| `/reel` API client                     | [`apps/mobile/src/services/api.ts`](../apps/mobile/src/services/api.ts) (search `reelApi`)                   |
| `/reel` route + suggested ranking      | [`backend/src/routes/reel.py`](../backend/src/routes/reel.py)                                                |
| `/quiz/journey/sessions` + SRS pull    | [`backend/src/routes/quiz.py`](../backend/src/routes/quiz.py) (search `start_journey_session`)               |
| Migration                              | [`backend/prisma/migrations_manual/2026_05_15_user_reel_movies.sql`](../backend/prisma/migrations_manual/2026_05_15_user_reel_movies.sql) |

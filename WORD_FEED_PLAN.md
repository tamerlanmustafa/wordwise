# WordWise: Vocabulary-App-First Plan

*Drafted 2026-07-16. Status: approved, not yet started.*

## Goal

Reposition the app so its **first mission is vocabulary learning**: Home becomes a
full-screen swipeable feed of new words matched to the user's CEFR level, built
entirely from the existing lemma/sense/sentence/translation DB. The movie
experience consolidates into a single Movies tab.

Bottom bar becomes: **Words (Home) · Movies · Practice · Profile**.

### Decisions made

| Decision | Choice |
|---|---|
| Feed style | Full-screen swipe cards (TikTok-style vertical snap), one word per swipe |
| Movie list destination | Merged into one Movies tab (Discover + My Movies segments) |
| Schema changes | **None in v1** — exclusion via existing `user_words`; local seen-set on device |

### What this builds on (already exists)

- **DB**: global `Lemma` table (CEFR level, frequency rank, priority score),
  `WordSense`, `TranslationMemory` (cached word+sentence translations per
  language), global LLM `SentenceBank` + `SentenceLemmaLink` (backfill worker
  live in prod), `HiddenWord` curation, `UserWord` (saved/learned + Leitner SRS
  state), `UserWordInteraction` log.
- **Backend**: `/srs/today` (Word of the Hour, `backend/src/routes/srs.py`)
  already implements the core query — level-matched lemmas guaranteed to have a
  global LLM example sentence, filtered through `hidden_words`.
- **Mobile**: `TodayWordCard` (flip-to-translation card), 4-tab bottom bar,
  saved-word lists, SRS/quiz/Practice loop, `reelStore` as the zustand paging
  pattern to mirror.

---

## Phase 1 — Backend: `GET /srs/feed` (~0.5 day)

Generalize the `/srs/today` candidate query (`backend/src/routes/srs.py:867`)
into a shared helper, then build a paginated feed on top of it.

**Query**
- Same candidate pool as today-card: user's level + one above, real-word regex,
  `hidden_words` excluded, **must have a global LLM sentence** (`sentence_bank`
  rows with `movie_id IS NULL AND source = 'llm'`) so every card renders.
- New exclusion: `NOT EXISTS` in `user_words` for this user — saved and
  "I know this" words never reappear.
- Deterministic per-user **daily** seed (same md5 trick as `/srs/today`, day
  granularity instead of hourly) so pagination is stable within a day and the
  feed reshuffles overnight.

**Params**: `limit`, `offset`, `target_lang`, optional `level` override.

**Each item returns**
- word, POS, CEFR badge, frequency rank, sense label
- best example sentence (via `SentenceLemmaLink.isRepresentative` / score)
- cached word + sentence translation from `TranslationMemory` for the user's
  target language (on-demand translation fallback, same as the today-card path)
- **2–3 movie chips** from `MovieLemmaMapping` (title + poster) — the bridge
  that sells the Movies tab from inside the word feed

**Tests** (`backend/tests/`): level filtering, saved/learned/hidden exclusion,
page stability within a day, every item has a sentence.

---

## Phase 2 — Mobile: Home = swipe-card word feed (~2 days)

**Store**: new `wordFeedStore.ts` (zustand, mirrors `reelStore` patterns):
paging, pull-to-refresh, optimistic save/known, and a local AsyncStorage
"recently seen" set so passively-swiped words don't repeat across sessions
without needing server state.

**Screen**: rework `HomeScreen.tsx` into a vertical snap FlatList of
full-screen word cards.
- Extract the flip-to-translation internals out of `TodayWordCard.tsx` into a
  shared component rather than duplicating it.
- The standalone Word-of-the-Hour card goes away (the feed *is* that,
  pluralized); the `/srs/today` endpoint stays for notifications.
- Home header keeps bell + profile; movie search moves to the Movies tab.
- The ad slot becomes an interstitial card every N swipes.

**Card actions**
- Tap to flip → translation (word + sentence)
- **Save** → existing `user_words` API, feeds the SRS/Practice loop
- **I know this** → `isLearned = true`
- Movie chips → existing `navigateToMovie`
- Saves and knowns count toward the daily goal; passive swipes don't.

**Interaction logging**: log saves/knowns/flips through the existing
`UserWordInteraction` table with consistent metadata (lemma id, CEFR level,
source: feed). Kept deliberately tidy — this is the raw material for the
aggregate difficulty data described in "Data asset groundwork" below.

**Tests** (mobile conventions: logic + integration only, no render lib):
store paging / optimistic save / seen-set, plus a cross-store flow test
(feed save → appears in notebook/SRS).

---

## Phase 3 — Movies tab consolidation (~1 day)

- `MyMoviesScreen` gains a **Discover | My Movies** segment control.
- `HomeSearchBar`, `LevelSortControls`, `RankedMovieList`, and the trending
  `SnapPager` move there wholesale — they're self-contained components, so this
  is mostly relocation, not rewriting.
- `src/core/App.tsx` updates: tab icon/label ("Words" home), `searchResults`
  back-target becomes the Movies tab, Android-back and `activeTab` mappings
  adjusted.

> **Sequencing**: Phase 3 must ship in the same release as Phase 2 — Phase 2
> alone leaves movie discovery homeless.

---

## Phase 4 — Positioning polish (separate pass, after the above ships)

- Onboarding copy: "learn words at your level, from real movies"
- Notification deep-links into the feed
- Store-listing copy
- Landing-page copy (public `frontend/` pages are fair game per the freeze rules)
- **Privacy policy update** — see "Data asset groundwork" below. Must land
  before (or with) the feed release, since the feed is what generates the data.

---

## Data asset groundwork

The feed's interaction stream (save / "I know this" / flip / quiz result, per
word × movie × native language × CEFR level) is *observed* word-difficulty
data — unlike predicted difficulty from wordlists, nobody else has it. It only
becomes valuable at scale (a year-two question, and only if the consumer app
grows), but the groundwork is cheap now and expensive to retrofit:

1. **Privacy policy language** (Phase 4, blocking the feed release): add a
   clause permitting use of **anonymized, aggregated** learning data for
   research, product improvement, and published statistics (e.g. movie
   difficulty rankings). No sale of personal data; individual-level data stays
   out of scope. Update the public privacy page in `frontend/` (allowed under
   the freeze) and the in-app `PrivacyScreen`. Retrofitting consent after
   collecting the data is much harder than shipping the clause first.
2. **Clean logging** (Phase 2): all feed interactions flow through
   `UserWordInteraction` with consistent metadata so aggregates can actually be
   computed later.
3. **Use aggregates as marketing, not merchandise**: "the 20 hardest movies
   for English learners"-style rankings as PR/SEO content to grow the user
   base. Selling the dataset (ESL publishers, localization QA) is deferred
   until there's enough volume for the numbers to mean anything — not Hollywood
   creatives, who handle global comprehension via localization, not scripts.

---

## Deliberately out of v1

- **No schema migration.** If repeat-exposure of un-actioned words annoys
  users, add a `FEED_SEEN` value to the `interactiontype` enum later via the
  manual-SQL flow (`backend/prisma/manual/`).
- No audio pronunciation.
- No web parity (`frontend/` is frozen).

## Estimate

~3.5–4 days total: Phase 1 ≈ 0.5d · Phase 2 ≈ 2d · Phase 3 ≈ 1d · Phase 4 separate.

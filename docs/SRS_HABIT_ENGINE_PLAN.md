# WordWise: Reel → SRS Habit Engine

> **Living checklist.** Tick boxes as work lands. After plan approval we'll
> copy this file to the repo (e.g. `docs/plans/srs-habit-engine.md`) so you
> can edit it directly too — until then the canonical copy is here.

---

## Context

Today the daily habit is `DAILY_GOAL = 3` quiz sessions, streak is local-only
(`AsyncStorage`), one missed day wipes everything, and the Reel is a flat
user-curated list with no progress signal. The model has three weaknesses:

1. **No spacing.** Words a user studies today aren't resurfaced 3–6 days
   later, despite the partial Leitner schema already in `UserWord` going
   unused by quiz completion.
2. **No mercy.** A single missed day resets the streak — directly opposite
   the design pattern shown to lift retention ~48% (`srs.md:23-24`).
3. **No bridge from study back to movie discovery.** The user studies words
   from a movie but the app never says *"you can probably watch this one
   now."*

This plan layers a ~2-minute daily SRS review on top of the existing reel,
adds mercy infrastructure (free + IAP freezes), wires quiz results into the
already-existing `UserWord.srsBox` Leitner data, and introduces a
"Ready to Watch" recommendation shelf that closes the study→movie loop.

Reference: `srs.md` (research synthesis the user wrote), and the two
exploration reports collected during planning.

---

## Locked decisions (from user clarification)

| Topic | Decision |
|---|---|
| **Studied-word signal** | Word appears in `QuizCardResult` (translation MCQ, synonym MCQ, or self-rate). Save/translation-view do **not** count. |
| **Movie status thresholds** | % of `MovieLemmaMapping` lemmas with qualifying `UserWord` state. `Unstudied` = 0%; `Studied` ≥ 30% have `srsBox ≥ 2`; `Mastered` ≥ 80% have `srsBox = 5`. (Tunable; defaults shown.) |
| **Daily routine shape** | One ~2-min session (~10 SRS-driven cards). `DAILY_GOAL` collapses from 3 sets → 1 session. |
| **Monetization shift** | **Daily 2-min SRS is FREE for everyone.** Premium unlocks: unlimited extra SRS sessions/day, larger queue caps, advanced analytics, ad-free, freeze IAP bundle. Paywall moves from "can you review at all" → "can you grind extra reviews today." Requires editing `MONETIZATION_PLAN.md` §3 — the existing 3-preview-then-paywall model is replaced. |
| **Streak freeze model** | Free auto-grant 1/week (max 2 held) **+** IAP consumable freeze pack (available to free and premium). |
| **New card type (v1)** | Synonym MCQ. Antonym deferred. |
| **Tip popups** | Mid-review, when an SRS-resurfaced word reappears. "Don't show again" persists. |
| **Reco surface** | New "Ready to Watch" horizontal shelf above the user's reel. |

---

## CRITICAL: existing code to reuse (do NOT duplicate)

Phase-1 research surfaced significant existing infrastructure that the original plan would have re-implemented. Reuse map:

| Concept | Lives in | What to do |
|---|---|---|
| Leitner box intervals `[1, 3, 7, 14, 30]` | [`srs.py:39`](backend/src/routes/srs.py#L39) | Extract to new `backend/src/services/srs_engine.py` so both `srs.py` and `quiz.py` import the same constants. |
| `_next_due(box)` | [`srs.py:51-54`](backend/src/routes/srs.py#L51-L54) | Extract alongside intervals. |
| Box-advancement + streak math | [`srs.py:269-331`](backend/src/routes/srs.py#L269-L331) (`record_review`) | Extract the per-card advance + user-rollup logic into `srs_engine.advance_from_review(...)` so the new "quiz completion → SRS advance" loop calls the SAME function. |
| SRS-due reintroduction picker | [`quiz.py:749-813`](backend/src/routes/quiz.py#L749-L813) (`_movie_specific_words`) | Already pulls SRS-due words first (capped at 2). The daily review is a generalization of this — `/srs/session/start` is the better home than a new `/srs/daily-queue`. |
| 10-card SRS session | [`srs.py:163-266`](backend/src/routes/srs.py#L163-L266) (`start_session`) | **This IS the 2-min daily session.** Do not duplicate. Extend it to pad with 1–2 fresh lemmas from next unstudied reel movie when the due queue is short. Rework `SRS_FREE_PREVIEW_SESSIONS` gating: free users get **1 session/day**; premium gets unlimited. |
| Subscription IAP plumbing | [`billing.py`](backend/src/routes/billing.py) (scaffolded, 501) | Reuse Apple/Google receipt-validation patterns for the **consumable** freeze IAP. Add new route file `consumables.py` — separate concern from subscription receipts. |
| "Today's Word" home daily | [`srs.py:337-462`](backend/src/routes/srs.py#L337-L462) (`todays_word`) | Stays as a separate discovery surface. The daily 2-min review is additive, not a replacement. |

---

## Architecture overview

Current state already has the bones of an SRS — `UserWord` rows carry
`srsBox` (1–5 Leitner) and `srsDueAt` keyed on `(userId, word, movieId)`.
But quiz completion *does not* advance the box: the `/srs/review` endpoint
is a separate flow. **The single highest-leverage backend change is wiring
quiz completion into the SRS engine.**

Data flow after this change:

```
QuizCardResult row written ──▶ srs_service.advanceFromQuizCard()
                                       │
                                       ├─▶ user_words.srsBox ± 1
                                       ├─▶ user_words.srsDueAt = now + interval[box]
                                       └─▶ user_movie_progress recomputed (cached)

GET /srs/daily-queue ──▶ ~10 cards: due-today, then near-due, then 1-2 fresh
                          from next unstudied movie in reel

GET /reel/with-progress ──▶ each tile: status (Un/Studied/Mastered) + comprehensibility %
GET /movies/ready-to-watch ──▶ top-N non-reel movies ranked by comprehensibility %
```

`dailyGoalStore` (currently local-only) becomes a thin read-through cache
over a new backend `/daily/state` so streak + freeze inventory survive
device reinstalls.

---

## Workstreams

### W1 — Backend: Quiz → SRS bridge + daily review queue

Files: [`backend/src/routes/quiz.py`](backend/src/routes/quiz.py),
[`backend/src/services/quiz_service.py`](backend/src/services/quiz_service.py),
[`backend/src/services/`](backend/src/services/) (new `srs_scheduler.py`),
[`backend/prisma/schema.prisma`](backend/prisma/schema.prisma).

- [ ] Define Leitner interval table: box 1 → 1d, 2 → 3d, 3 → 7d, 4 → 14d, 5 → 30d (Cepeda 2008 optimal-ridgeline aligned to 4-week retention target).
- [ ] Implement `srs_scheduler.advance_from_quiz_card(userId, word, movieId, isCorrect)`: correct → `srsBox = min(5, box+1)`, incorrect → `srsBox = 1`. Update `srsDueAt = now + interval[newBox]`, `srsLastReviewedAt = now`.
- [ ] In `quiz.complete_session` handler, after writing `QuizCardResult` rows, iterate scored cards and call the advance function for each. Self-rate cards: `know` → correct, `kinda` → no change, `dont` → incorrect.
- [ ] New endpoint `POST /srs/daily-queue` returning `{cards: [...], queue_id}`. Composition:
  - up to 8 due-today cards (`srsDueAt <= today`), ordered by oldest due
  - 1–2 near-due (`srsDueAt <= today + 24h`) if queue underfilled
  - 1–2 fresh lemmas from the next "Unstudied" movie in user's reel (creates new `UserWord` rows on first answer)
- [ ] Cache the day's queue per `(userId, date)` so refresh is stable; invalidate when user submits the queue.

### W2 — Backend: Streak persistence + freeze inventory + IAP

Files: [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma),
[`backend/src/routes/`](backend/src/routes/) (new `daily.py`, `streak.py`),
[`backend/src/services/`](backend/src/services/) (new `streak_service.py`).

- [ ] New model `UserStreakFreeze`: `id`, `userId`, `acquiredAt`, `acquiredVia` enum (`auto_weekly | iap | repair_grant`), `consumedAt`, `consumedReason` (nullable).
- [ ] Repurpose existing `User.srsCurrentStreak` / `srsLongestStreak` / `srsLastSessionDate` as the canonical daily-habit streak (drop the local-only AsyncStorage source of truth). Migration: backfill from devices is impossible — accept reset on rollout, surface a one-time "we improved streaks, here's a 7-day grace freeze" message.
- [ ] `POST /daily/complete` — called when the 2-min review finishes. Increments streak per yesterday-or-today logic (port from `dailyGoalStore.ts:138-147`).
- [ ] `GET /daily/state` — returns `{ today_done, streak, longest_streak, freezes_held, last_session_date, repair_window_active }`. On read, auto-consume a freeze if `today - last_session_date == 2` and `freezes_held > 0`.
- [ ] Weekly grant: in `GET /daily/state` lazily check "if today is Sunday and user holds < 2 freezes and no `auto_weekly` grant this week, grant one." Avoids needing a real cron in v1.
- [ ] IAP: define consumable product `freeze_pack_5` ($1.99, 5 freezes). Endpoint `POST /iap/freeze-pack/verify` accepts the receipt, validates with Apple/Google, credits 5 `UserStreakFreeze` rows with `acquiredVia = iap`.

### W3 — Backend: Movie status + comprehensibility

Files: [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma),
[`backend/src/routes/reel.py`](backend/src/routes/reel.py),
[`backend/src/routes/movies.py`](backend/src/routes/movies.py),
[`backend/src/services/`](backend/src/services/) (new `movie_progress_service.py`).

- [ ] New model `UserMovieProgress`: `userId`, `movieId`, `lemmasTouched`, `lemmasInBox2Plus`, `lemmasMastered`, `comprehensibilityPercent` (frequency-weighted), `status` enum (`unstudied | studied | mastered`), `updatedAt`. Composite key on `(userId, movieId)`.
- [ ] Comprehensibility formula = `sum(frequencyInMovie WHERE srsBox >= 2) / sum(frequencyInMovie)` — frequency-weighted via `MovieLemmaMapping.frequencyInMovie`. High-frequency words count more than rare ones.
- [ ] Status thresholds (tunable constants): `Studied` if `lemmasInBox2Plus / totalLemmas >= 0.30`; `Mastered` if `lemmasMastered / totalLemmas >= 0.80`.
- [ ] Recompute on any quiz completion: identify which movies the answered words belong to (via `UserWord.movieId`), recompute progress for each, upsert.
- [ ] Extend `GET /reel/` response to include `{ status, comprehensibility_percent }` per tile.
- [ ] New endpoint `GET /movies/ready-to-watch?limit=5` — returns top-N movies the user does NOT have in their reel, ranked by comprehensibility %. Excludes already-mastered. Floor at 40% so we don't surface near-empty matches.

### W4 — Backend: Synonym MCQ card type

Files: [`backend/src/services/quiz_service.py`](backend/src/services/quiz_service.py),
[`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) (extend `card_type` enum/string).

- [ ] Verify what synonym data exists: check `WordClassification` and any dictionary/thesaurus tables. **If no synonym data exists yet, this is a blocker** — surface it during implementation and decide whether to (a) integrate WordNet, (b) use an existing LLM call, or (c) drop synonym MCQ to v1.1. Do not guess.
- [ ] Add card type `synonym_mcq`. Generator: given a target lemma, return 1 correct synonym + 3 CEFR-matched distractors (non-synonyms at the same CEFR level).
- [ ] Card-type selection in the daily queue: `srsBox = 1` → translation MCQ only; `box 2–3` → 70/30 translation/synonym mix; `box 4–5` → synonym MCQ for variety. (Reinforces the same lemma from a different angle as it matures.)

### W5 — Frontend: 2-minute daily review session

Files: [`apps/mobile/src/stores/dailyGoalStore.ts`](apps/mobile/src/stores/dailyGoalStore.ts),
[`apps/mobile/src/services/api.ts`](apps/mobile/src/services/api.ts) (add `dailyApi`, `srsApi.dailyQueue`),
new screen `apps/mobile/src/components/screens/DailyReviewScreen.tsx`,
[`apps/mobile/src/components/QuizResultScreen.tsx`](apps/mobile/src/components/QuizResultScreen.tsx),
[`apps/mobile/src/components/screens/JourneyScreen.tsx`](apps/mobile/src/components/screens/JourneyScreen.tsx).

- [ ] Drop `DAILY_GOAL = 3` → `DAILY_GOAL = 1` in `dailyGoalStore.ts:39`.
- [ ] Convert `dailyGoalStore` to a read-through cache over `GET /daily/state`. Local AsyncStorage stays as offline fallback only.
- [ ] New `DailyReviewScreen.tsx`: fetches `/srs/daily-queue`, runs ~10 cards using existing quiz card components (reuse `QuizLessonScreen`'s card primitives — do not duplicate).
- [ ] `QuizResultScreen.tsx` journey mode: replace 3-pip strip (`QuizResultScreen.tsx:117-129`) with a single completion ring; `justHit3` (`:151-159`) becomes "session completed" wall when this is the daily review.
- [ ] `JourneyScreen.tsx`: replace the existing pip-anchored top with a sticky **"Today's 2-min review"** CTA, larger and higher-contrast than the reel tiles. Hide once today's session is done; replace with "Today's done · Streak: N 🔥".

### W6 — Frontend: Reel tile redesign (status + comprehensibility %)

Files: [`apps/mobile/src/components/screens/JourneyScreen.tsx`](apps/mobile/src/components/screens/JourneyScreen.tsx),
the existing `ReelTile` component (locate during implementation), and possibly
[`apps/mobile/src/components/MoviePreviewHub.tsx`](apps/mobile/src/components/MoviePreviewHub.tsx).

- [ ] Add status badge (small chip) per tile: dot color from `cefrColors` palette (already used elsewhere). Labels: `New`, `Studying · 47%`, `Final Cut`. Reuse `cefrColors` from `apps/mobile/src/theme/palette.ts`.
- [ ] Comprehensibility % overlay on poster (small chip, bottom-left).
- [ ] `Mastered` tiles get a cinema cosmetic overlay ("Final Cut" stamp). Use existing typography tokens.
- [ ] Nothing is gated — tiles remain fully tappable regardless of status (per user's earlier feedback: don't lock the user's own reel).

### W7 — Frontend: "Ready to Watch" shelf

Files: new `apps/mobile/src/components/journey/ReadyToWatchShelf.tsx`,
[`apps/mobile/src/components/screens/JourneyScreen.tsx`](apps/mobile/src/components/screens/JourneyScreen.tsx),
[`apps/mobile/src/services/api.ts`](apps/mobile/src/services/api.ts).

- [ ] New horizontal-scroll component above the user's reel. 3–5 movies from `GET /movies/ready-to-watch`. Each card: poster, title, comprehensibility %, "+ Add to reel" CTA.
- [ ] Empty state (user has no qualifying movies yet — early days): hide the shelf entirely. No "we couldn't find anything" copy.
- [ ] Refresh on app foreground; 1-hour client-side cache via React Query or whatever pattern is already in use (check during implementation).

### W8 — Frontend: Tip popup primitive + spacing-effect tip

Files: new `apps/mobile/src/components/common/TipPopup.tsx`,
new `apps/mobile/src/stores/tipDismissalsStore.ts`,
[`apps/mobile/src/services/api.ts`](apps/mobile/src/services/api.ts).

- [ ] Reusable `TipPopup` modal: title, body, single "Got it" CTA, "Don't show again" toggle. Dark/light themed via `useThemeColors`.
- [ ] Trigger inside `DailyReviewScreen` when a card belongs to a word with `srsLastReviewedAt != null` (i.e. it's reappearing). Show on the *first* such card in a session, once per `tip_key` unless dismissed.
- [ ] `tip_key`s (v1): `spacing_first_repeat`, `spacing_3day_window`, `spacing_loss_aversion`. Body copy stays plain-English ("Studies suggest reviewing a word 3–6 days after first seeing it is when it sticks. You just hit that window for `freedom`.").
- [ ] Persistence: local `tipDismissalsStore` (AsyncStorage). No backend mirror needed for v1.
- [ ] Rate-limit: max 1 tip per session, max 1/week per `tip_key` even if not dismissed.

### W9 — Frontend: Variable-reward chest at end of session

Files: new `apps/mobile/src/components/journey/ChestReveal.tsx`,
[`backend/src/routes/`](backend/src/routes/) (extend `/daily/complete` response),
[`apps/mobile/src/components/QuizResultScreen.tsx`](apps/mobile/src/components/QuizResultScreen.tsx).

- [ ] Backend: extend `POST /daily/complete` to return `{ xp_earned, chest: { type, payload } }`. **Server picks the reward** (anti-tamper).
- [ ] Reward weights (tunable):
  - Just XP, no extra: 50%
  - +50% XP boost on next session: 20%
  - 2× XP for the first card next session: 15%
  - 1 streak freeze (cap at 2 held; reroll if full): 10%
  - Cosmetic poster frame for a reel movie (dedupe across owned): 5%
- [ ] Frontend: animated chest reveal at the end of `DailyReviewScreen`. Reuse existing `Animated` patterns from `QuizResultScreen.tsx:73-86`.
- [ ] Boost persistence: store active boost in `dailyGoalStore` (or new `boostsStore`), consume on next session start.

### W10 — Frontend: Cinema-named streak milestones

Files: new `apps/mobile/src/components/journey/MilestoneUnlockModal.tsx`,
[`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) (add `User.unlockedCosmetics` JSON),
[`apps/mobile/src/components/screens/JourneyScreen.tsx`](apps/mobile/src/components/screens/JourneyScreen.tsx).

- [ ] Milestones: 7 → "Opening Weekend", 30 → "Box Office", 100 → "Cult Classic", 365 → "Criterion Collection".
- [ ] Each unlock awards a cosmetic (sprocket color / film-stock background variant on the reel). v1 ships 4 cosmetic palettes — implement applier on `JourneyScreen` background only; expand surfaces in a v1.1.
- [ ] Modal fires once on the session-complete return after crossing the threshold. Backend gates: `User.unlockedCosmetics` is the source of truth.

### W11 — Streak repair flow ⏸ **DEFERRED to P3.1**

Reason for deferral: doing this right requires preserving the pre-gap
streak value across `srs_engine.advance_user_rollup_after_review` (which
currently resets streak to 1 on a 2+ day gap), then conditionally
restoring it when today's session crosses the accuracy bar. That's a
new `srsPreRepairStreak` column + a multi-call state machine that
straddles `/srs/review` and `/srs/session/complete`. P3's W2 mercy
(auto-weekly freezes + IAP) covers most lost-streak scenarios without
this — repair is the backstop for users with 0 freezes.

When we pick this up, the simplified flow is:
- `auto_apply_mercy` sets `repair_window_active=true` for the narrow
  case in `streak_service.repair_window_active`.
- A new `User.srsPreRepairStreak` column captures the streak value when
  the gap was detected (set just before the reset would happen).
- `/srs/session/complete` checks: if accuracy ≥ 80% AND
  `srsPreRepairStreak` is set, restore `srsCurrentStreak =
  srsPreRepairStreak + 1` and clear the field. Otherwise the reset
  stands.

Files: new `apps/mobile/src/components/journey/StreakRepairModal.tsx`,
backend `/streak/repair` endpoint (W2).

- [ ] On app foreground, if `repair_window_active` (set when yesterday was missed AND freezes were 0 AND < 24h since midnight), show repair modal: "Do today's review **twice** to save your N-day streak."
- [ ] Backend tracks attempts; on the 2nd successful completion within the window, restore streak (`srsCurrentStreak += 1` against the missed day) and clear the window flag.
- [ ] Only offered once per missed day. No grinding 5 sessions to compound recoveries.

---

## File-by-file change map (critical paths)

**Backend:**
- `backend/prisma/schema.prisma` — `UserStreakFreeze`, `UserMovieProgress`, `User.unlockedCosmetics`, extended `card_type`
- `backend/src/routes/quiz.py` — wire `complete_session` into SRS advance
- `backend/src/routes/reel.py` — extend response with status + comprehensibility
- `backend/src/routes/movies.py` — `/movies/ready-to-watch`
- `backend/src/routes/daily.py` (new) — `/daily/state`, `/daily/complete`
- `backend/src/routes/streak.py` (new) — `/streak/use-freeze`, `/streak/repair`
- `backend/src/routes/srs.py` (existing or new) — `/srs/daily-queue`
- `backend/src/routes/iap.py` (new) — `/iap/freeze-pack/verify`
- `backend/src/services/srs_scheduler.py` (new)
- `backend/src/services/movie_progress_service.py` (new)
- `backend/src/services/streak_service.py` (new)
- `backend/src/services/quiz_service.py` — synonym MCQ generator

**Mobile:**
- `apps/mobile/src/stores/dailyGoalStore.ts` — DAILY_GOAL=1, backend mirror
- `apps/mobile/src/stores/tipDismissalsStore.ts` (new)
- `apps/mobile/src/services/api.ts` — `dailyApi`, `srsApi.dailyQueue`, `readyToWatchApi`, `iapApi`
- `apps/mobile/src/components/screens/DailyReviewScreen.tsx` (new)
- `apps/mobile/src/components/screens/JourneyScreen.tsx` — top CTA, shelf, redesigned tiles
- `apps/mobile/src/components/QuizResultScreen.tsx` — journey-mode collapse to single ring
- `apps/mobile/src/components/journey/ReadyToWatchShelf.tsx` (new)
- `apps/mobile/src/components/journey/ChestReveal.tsx` (new)
- `apps/mobile/src/components/journey/MilestoneUnlockModal.tsx` (new)
- `apps/mobile/src/components/journey/StreakRepairModal.tsx` (new)
- `apps/mobile/src/components/common/TipPopup.tsx` (new)

---

## Reuse map (do NOT duplicate)

- **Quiz card UI** — reuse the card components inside `QuizLessonScreen` rather than building new ones for `DailyReviewScreen`.
- **`cefrColors` / `cefrLabels`** in `apps/mobile/src/theme/palette.ts` — for status badge colors.
- **`useThemeColors` + light/dark inversion** — applies to every new modal/popup.
- **Animation pattern** in `QuizResultScreen.tsx:73-86` — copy for ChestReveal.
- **`wordwiseApi.logInteraction`** — existing interaction logger; use for any new event types added by the daily review.
- **Leitner box advancement intervals** — there's likely already a constant somewhere in the SRS preview endpoints (check `backend/src/routes/srs.py` if it exists before defining a new one).

---

## Phasing — what to ship in what order

| Phase | Workstreams | Why |
|---|---|---|
| **P1 — Foundation** | W1, W3 | Quiz→SRS wiring + movie status. Unlocks every visible change. Ships value (better SRS) even without UI. |
| **P2 — Daily habit** | W5, W6 | 2-min session + tile redesign. Big visible shift. Requires P1. |
| **P3 — Mercy + reward** | W2, W9, W11 | Freeze inventory, chest, repair. Retention drivers. |
| **P4 — Discovery + education** | W7, W8 | Ready-to-Watch shelf, tip popups. |
| **P5 — Polish** | W4 (synonym MCQ), W10 (milestones) | Variety + long-tail unlocks. Lower-risk-of-blocking-launch items. |

If we hit a blocker on W4 (no synonym data exists), demote synonym MCQ to v1.1 and ship the rest.

### 🚦 Testing is a hard gate between phases

**Do not start the next phase until the current phase's tests pass and the smoke test is verified by the user.** Each phase ends with:

1. **Backend pytest run** for new/changed modules — must pass.
2. **End-to-end smoke test** from the Verification section (manual click-through in dev) — must pass.
3. **User sign-off** — surface the test results in the chat and ask for go-ahead before starting the next phase.

If tests fail or the smoke test reveals issues, fix forward in the current phase. Do not paper over with try/except, do not silently skip, do not move on.

---

## Verification

End-to-end smoke tests (manual, run after each phase):

- [ ] **P1**: Complete a movie quiz → DB check confirms `UserWord.srsBox` advanced for correct cards and reset to 1 for incorrect; `srsDueAt` reflects interval table.
- [ ] **P1**: After 5+ words in box ≥ 2 on the same movie, `GET /reel/with-progress` returns that movie with status `studied` and a non-zero comprehensibility %.
- [ ] **P2**: Open app, tap "Today's 2-min review" → ~10 cards delivered, mostly due-today, padded with 1–2 fresh from next unstudied reel movie.
- [ ] **P2**: Complete the session → daily-done state, streak bumps, top CTA replaced with "Today's done".
- [ ] **P3**: Skip a day with 1 freeze held → next open auto-consumes the freeze, streak intact, freeze inventory decremented.
- [ ] **P3**: Skip a day with 0 freezes → repair modal shown; complete review twice → streak restored.
- [ ] **P3**: IAP test purchase (sandbox) → 5 freezes credited; receipt validation logs success.
- [ ] **P4**: `GET /movies/ready-to-watch` returns 3–5 non-reel movies ranked by % desc; shelf renders, "+ Add to reel" works.
- [ ] **P4**: During daily review, when a previously-reviewed word comes back, tip popup fires once; dismissing with "don't show again" persists across app restart.
- [ ] **P5**: Hit a 7-day streak → "Opening Weekend" unlock modal; cosmetic applied to reel background; persists across sessions.

Backend unit/integration tests (pytest):

- [ ] `test_srs_scheduler.py` — box advancement (correct, incorrect, self-rate variants); due-date math at each box.
- [ ] `test_daily_queue.py` — composition logic (due-today priority, near-due fallback, fresh-from-reel padding, queue stability within a day).
- [ ] `test_movie_progress.py` — frequency-weighted comprehensibility calculation; status threshold transitions.
- [ ] `test_streak_service.py` — yesterday-or-today increment, weekly grant idempotency, freeze auto-consume, repair-window enforcement.
- [ ] `test_iap.py` — receipt validation happy/sad path with mocked Apple/Google verifier.

---

## Out of scope (explicit non-goals for v1)

- Antonym MCQ card type (after synonym lands successfully).
- CEFR-weighted mastery thresholds (the simpler frequency-weighted % is the v1).
- Genre-achievement badges ("Sci-Fi Fluent").
- Onboarding rewrite — the first-launch flow stays untouched; the spacing-effect tip pops in mid-review on day ~2 naturally.
- Push notifications for missed-day mercy reminders — separate workstream.
- Backfilling existing users' streaks from device storage to backend (impossible without a client-driven migration; accept reset + grace freeze).

---

## Open implementation-time questions to surface as they arise

These are not blockers for the plan but will need user input when reached:

1. **Synonym data source** (W4) — if no synonym table exists, choose between WordNet integration, LLM-at-generation-time, or deferring synonym MCQ to v1.1.
2. **IAP product pricing** (W2) — `$1.99 / 5 freezes` is a placeholder; user picks the actual SKU.
3. **Cosmetic art assets** (W6, W10) — the "Final Cut" stamp, sprocket colors, film-stock palettes need either user-provided art or a clear "use placeholder shape + Tailwind color tokens for v1" decision.
4. **Backend cron vs lazy weekly-grant** (W2) — plan defaults to lazy (no cron infra needed). If user prefers a real scheduled job, scope expands.

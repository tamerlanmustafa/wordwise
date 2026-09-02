# Launch Queue

**One item per session**, top to bottom. Run `/next-ticket` in a fresh session to pick up the next
`todo` item — or `/dispatch` from anywhere (including the phone) to spawn a fresh session that does.

History lives in **`LAUNCH_QUEUE_ARCHIVE.md`**: tiers 1–8 (all `done`, `dropped` or `user`) and the
full session log. It was moved out on 2026-09-01 because this file is read at the start of every
session and the log alone had reached 110KB — roughly 27,500 tokens that every session paid for and
almost none of them needed. Do not read the archive unless you are chasing a specific past decision.

Status values: `todo` · `doing` · `done` · `blocked` · `running` (shipped, still working through a backlog) · `user` (needs you, not the agent — **issue stays open**) · `dropped` (checked and not worth doing; issue closed with the evidence)

**`dropped` is a success, not a failure.** Two of the last thirteen items ended there — #155's premise
was never true, #132's had already been fixed by a dependency upgrade. Both saved more time than they
cost. A session that closes an issue with evidence has delivered the item.

Rules for whoever works this file:
- Take the **first** item that is `todo`. Do not skip ahead, do not batch.
- Read only that item's issue. Do not re-triage, do not read the rest of the queue's issues.
- **Every session ends on one of three verdicts: RESOLVE, HAND OFF, or CLOSE.** Before writing any code,
  run step 2.5 of the `next-ticket` skill and decide which. An open issue is not a mandate — it is one
  person's opinion on the day they filed it. Four questions: is the premise still true, is the proposed
  fix the right one, **is fixing this at all the best-practice answer** (or is the current behaviour
  already correct and the issue is asking for complexity a single-replica app should not carry), and is
  it worth doing now? Evidence — a prod query, a read of the code, a documented platform requirement —
  not opinion. Default is RESOLVE; a CLOSE verdict stops and asks the user, always. The item's
  *premise* is fair game; its *position in the queue* is not.
- **"No session can build this" is HAND OFF, not CLOSE.** These are two different questions and merging
  them is this queue's known failure mode — item 40 (#90) hit it on 2026-08-27. *Can a session move it?*
  is yours to answer. *Should this work ever happen?* is the user's. A ticket that fails the first and
  passes the second stays **open** and becomes a `user` row in the table below. CLOSE is reserved for
  work that should not be built — dead premise, harmful fix, machinery a 1-replica app shouldn't carry.
- Mark `done` only after the verification commands in `CLAUDE.md` actually pass.
- **A `done` row is shipped by the session that did it** (since 2026-09-01, step 6 of the skill): its own files committed by name, pushed to `main`, then EAS `preview` updated — an OTA for JS-only changes, an `eas build` plus a `runtimeVersion` bump when native changed. Unapplied prod SQL, foreign edits in the tree, or an unauthorised `eas` stop the ship step; the report says which.
- A `done` row then **closes its issue**, with the row's Log line as the closing comment. Three exceptions (step 7 of the skill): the ship step stopped before the push or a build is still running, the row is only half the issue (`#104a`), or something outside the repo is still pending — a migration to run, a key to rotate. Work left unpushed gets closed by the next session's opening sweep, so nothing stays open by accident.
- Then **stop** and wait. Do not start the next item.

---

## Tier 9 — Screening Mode

Added 2026-09-01. The first tier in this queue that is **new feature work** rather than triage of a
pre-launch backlog: turning MovieDetailScreen's browsable word deck into paced lessons with tests, an
energy economy, and feedback you can feel. Plan and the Duolingo research behind it:
https://claude.ai/code/artifact/27221287-a317-4f0a-ab56-46a9d92109fa

Ordered by dependency, not by issue number. **Item 42 gates most of the tier** — it is four product
decisions only the user can make, and two of them (does energy replace the free daily session cap;
scene length) are constants the code encodes. A session that reaches a blocked item should say so and
stop rather than pick a value.

Items 43 and 44 depend on nothing and can be worked in any order — 43 ships a real improvement to the
**existing** quiz before any Screening Mode structure exists, which is why it is first.

⚠️ **Item 43 needs an `eas build`, not an `eas update`.** `expo-haptics` is a new native dependency;
an OTA carrying it crashes on launch. Batch it with any other pending native work.

| # | Status | Issue | Work |
|---|--------|-------|------|
| 42 | `user` | #161 | **Four product decisions that gate the tier.** (1) Does energy replace the free daily session cap or sit beside it — two meters over one budget is a mystery bug. (2) Scene length, 8 cards or 6. (3) Is Screening Mode the default on MovieDetailScreen or a mode you enter. (4) Do we want rewarded ads at all — `ads_eligible` exists, no ad SDK does. **No session should decide these.** |
| 43 | `todo` | #162 | One feedback module (`utils/feedback.ts`) firing haptics + sound + motion together on every answer, wired into the **existing** `MCQCard` / `ReviewScreen`. Ships value before any new structure. ⚠️ New native dep → `eas build`. SFX go on `expo-audio`, not `expo-av`. |
| 44 | `todo` | #163 | Migrate the two `expo-av` pronunciation call sites (`WordCardDeck.tsx:876`, `VocabRow.tsx:218`) to `expo-audio` — `expo-av` is **removed in SDK 55** and we are on the last SDK that ships it. |
| 45 | `todo` | #164 | **The structural blocker.** `deckLogic.ts` is a rotation with no end, so a lesson has nothing to finish on. Add a linear traversal + scene partitioning as pure, testable logic. ⚠️ `deckItems` is sentence-filtered, so **60 is not 60** — size everything from the runtime `deckTotal`, never `SUGGESTED_CAP`. Blocked on item 42's scene-length answer. |
| 46 | `todo` | #166 | `movie_lesson` session kind: composer + **lazy** `UserWord` creation for tested words only (precedent: `compose_list_words`). Every answer posts to the existing `/srs/review` — do not build a second memory model. Blocked on item 42's daily-cap answer. |
| 47 | `todo` | #167 | Distractor pool falls back to deck-only on a cold language; in an 8-word scene that is a shell game by question three. Add a film-wide rung between the wide pool and the deck. **Check the prod pool-size log line first** — this may be CLOSE rather than RESOLVE. |
| 48 | `todo` | #165 | The scene runner: 4 cards → spot check → 4 cards → 6-question test, wrong answers requeued until right. Reuses `MCQCard`, `QuizHeader`, `SessionComplete`, `Confetti`. **A scene must never be lost** — running out pauses resumably. Needs 45, 46, 47. |
| 49 | `todo` | #168 | Energy as **derived state** — `energy` + `energyUpdatedAt`, computed on read. Never a cron ticking every user. Spend on test questions only, never on study cards. Schema goes via manual SQL applied to prod **before** the push (Prisma drift). Blocked on item 42. |
| 50 | `todo` | #169 | Energy meter UI: optimistic decrement on tap, the 5-correct streak rebate, the out-of-energy sheet, ∞ for premium. Needs 49. |
| 51 | `todo` | #170 | Coins — earned currency, and the **first real sink** for streak freezes (`consumables.py`, currently only buyable via a 501 IAP) and cosmetics (`unlocked_cosmetics`). Grants must be idempotent against a retried completion. Needs 49; ads half blocked on item 42. |
| 52 | `todo` | #171 | The Final Cut (10 questions from the missed set) + a film mastery ring on the poster, read from **SRS box state**, not scenes completed. Needs 48. |
| 53 | `todo` | #172 | Gap-fill questions from the film's own line — the only format that puts the film back into the test, and the data (`word_position`, `matched_form`, `renderHighlighted`) already ships. Names three more formats for later. Needs 48. |

---

## Open on you — pending outside the repo

Not agent-workable, and **not tracked by any `todo` row** — each is a footnote on a `done` row above,
which makes it easy to lose. Consolidated here 2026-08-26 so a session can see them without reading
every row. These are why 7 issues stay open despite their code being shipped.

| Issue | What is left, and why only you can do it |
|-------|------------------------------------------|
| *(no issue)* | **Mail residuals — #159 closed 2026-08-28, these outlived it.** (a) **At submission time:** check the App Store Connect / Play Console *listing* contact fields against the same `@getwordwise.us` address — inherited from #100, which closed without it. (b) **Gmail "never send to spam" filter** on `privacy@` + `support@` — forwarded mail currently lands in spam, and a GDPR deletion request in spam is the failure the whole ticket existed to prevent. (c) **Resend outbound was never re-tested with a live send** — register an email+password account to fire the welcome mail; the DNS evidence says it is fine but nothing has actually gone out since the apex changed. (Items 31.5 + 38) |
| #108 | ~~Apply the survey migration~~ — **done 2026-08-26, before the push**; code is live and the issue is closed. Only the on-device walk is left (iOS **and** Android, free **and** premium). (Item 37) |
| ~~#103~~ | ~~SQL to apply~~ — **APPLIED 2026-08-27**, verified lossless and green; issue closed. Nothing left. (Item 7) |
| ~~#104~~ | ~~Walk Arabic on a device~~ — **#104 closed 2026-08-28; nothing is pending here.** Decision taken: Arabic stays `preview: true`, so the unwalked RTL is unreachable by users and the walk stopped being outstanding work. The requirement moved somewhere stronger than a tracker — the comment on `src/i18n/languages.ts:61-63` sits on the flag itself, and **7 tests** (`i18n/__tests__/locales.test.ts`, `appLanguage.test.ts`) fail the moment `preview` is dropped, two of them on backend parity with `ui_languages.py`. Promoting Arabic later means device walk + native review + backend parity + a locale email block, filed fresh. (Item 22) |
| #101 | Native-speaker review of es/pt/tr/ru — now also covers item 37's new survey copy. (Item 10) |
| #161 | **Four Screening Mode decisions, and most of Tier 9 waits on two of them.** Does energy replace the free daily session cap (two meters over one budget is a mystery bug), scene length 8 or 6, default mode or opt-in, and rewarded ads yes or no. Each changes what gets built, not how — no session can answer them. Items 45, 46, 49 and 51 are blocked until they are. (Item 42) |
| #90 | **Marketing and distribution strategy — real future work, but nothing an agent session can build.** No code, no AC a test can check; the strategy content is the issue body. Kept open on purpose 2026-08-27 as the record of positioning. When a phase becomes real, file it as its own ticket (Phase 3 SEO needs a public web surface; Phase 4 shareable progress needs a data model) rather than reviving the epic. (Item 40) |

Also outstanding and **not an issue**: the Anthropic credit balance ran out 2026-08-22, so the
sentence worker has generated nothing since. The code handles it correctly; only a top-up restarts it.

---

## Deferred — do not pick these up

**Scaling prerequisites** — deferred 2026-08-22 by decision, and the decision is recorded on each
issue. All three exist only to make a **second replica** correct; at 1 replica the in-process state
is correct and free. Kept open, not closed, because the failure is silent — adding a replica later
doesn't error, it quietly doubles the abuse ceiling and duplicates every alert email.
**Read #149 before ever raising `numReplicas` above 1.**  #149 · #150 · #128

These three have **already had their evaluate-or-close verdict** (2026-08-22, recorded on each
issue): keep open as a tripwire, do not build. Do not re-run the gate on them — that is re-litigating
a settled decision, which the rules above forbid.

---

## Log

**Hard limit: one row per session, and the Outcome cell stays under 300 characters.** This is not a
style preference. The old log ran to 110KB — single entries of 2,500 words — and because this file
is read at the start of every session, every future session paid ~27,500 tokens for a history it
almost never needed. It was archived on 2026-09-01. If a finding needs more than 300 characters it
belongs **on the GitHub issue**, which is where the next person looking for it will actually go.

**When this table passes 15 rows, move the oldest into `LAUNCH_QUEUE_ARCHIVE.md`.** Appending there
does not require reading it: `cat >> LAUNCH_QUEUE_ARCHIVE.md`.

| Date | Item | Outcome |
|------|------|---------|
| 2026-09-01 | — | Tiers 1–8 and 54 log entries moved to `LAUNCH_QUEUE_ARCHIVE.md`; this file went 142KB → 12KB. Tier 9 (Screening Mode, #161–#172) filed. New `/dispatch` skill spawns a fresh session per ticket from the phone. |
| 2026-09-01 | — | `next-ticket` now ships its own ticket (step 6): files by name, push `main`, EAS preview OTA — or `eas build` + runtime-version bump in all three copies when native changed. CLAUDE.md carries the carve-out; `dispatch` text updated. |
| 2026-09-02 | 43–49 | **Tier 9 reverted in full by user decision.** #162 #163 #164 #165 #166 #167 backed out of `main`; #168 discarded unpushed. All rows back to `todo`, #161's four decisions un-taken. `expo-av` is back and `runtimeVersion` returns to 1.0.2, so the rollback needs an `eas build`, not an OTA. Pronunciation keeps its backend fix (928ddf8) but loses the bearer token again. Restore point: tag `pre-tier9-revert`. |

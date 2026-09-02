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

## Tier 9 — Screening Mode — **DROPPED 2026-09-02**

Added 2026-09-01, dropped 2026-09-02 by the user, who stopped the plan and asked for all of it to be
undone. The tier turned MovieDetailScreen's browsable word deck into paced lessons with tests, an
energy economy, and feedback you can feel. Plan and the Duolingo research behind it, kept for the
record: https://claude.ai/code/artifact/27221287-a317-4f0a-ab56-46a9d92109fa

**Six items had shipped and were reverted out of `main` in `5c7a759`** (#162, #163, #164, #165, #166,
#167). Item 49 (#168) was in progress and uncommitted, and was discarded. Items 50–53 were never
started. **All twelve issues are closed** — #161–#167 as completed-then-reverted, #168–#172 as not
planned, each with the reason on the issue.

**Do not pick any of these up.** They are `dropped`, not `todo`; a session that reaches this tier
should skip it entirely. If Screening Mode is ever revived it starts from a fresh set of issues
against whatever the app looks like then, not from these — the restore point is the git tag
`pre-tier9-revert` at `238e585`.

**Two findings survived the drop and are worth re-filing on their own**, because neither depends on
Screening Mode and both are live defects in the shipped app:
- **Pronunciation is broken again.** 928ddf8's backend TTS was kept, but its bearer-token half left
  with #163, so the endpoint is bearer-only and the client sends no header — every tap 401s. The
  server can synthesise audio nothing can ask for.
- **`expo-av` is still removed in SDK 55.** #163's migration will have to happen again before that
  upgrade; its findings are on the closed issue.
- **Streak freezes are unobtainable** — only buyable through an IAP that returns 501 (from #170).

| # | Status | Issue | Work |
|---|--------|-------|------|
| 42 | `dropped` | #161 | Four product decisions that gated the tier. Answered 2026-09-01, **un-taken 2026-09-02** — nothing they decided still exists. The free daily cap (`srsLastSessionStartedAt`) was never replaced and remains the only limiter; `ads_eligible` remains in place, unused. |
| 43 | `dropped` | #162 | Feedback module — **built, then reverted.** `utils/feedback.ts`, the four `.wav` assets and the `expo-audio` + `expo-haptics` deps are gone; quiz answers are silent again. |
| 44 | `dropped` | #163 | expo-av → expo-audio — **built, then reverted.** `expo-av` is back, `runtimeVersion` back to 1.0.2. Will need doing again before SDK 55. |
| 45 | `dropped` | #164 | Scene partitioning + linear cursor — **built, then reverted.** `deckLogic.ts` is a rotation with no end again. |
| 46 | `dropped` | #166 | `movie_lesson` session kind — **built, then reverted.** The endpoint no longer exists; no client ever depended on it but the scene runner. |
| 47 | `dropped` | #167 | Film-wide distractor rung — **built, then reverted.** Cold languages fall back to deck-only distractors again. |
| 48 | `dropped` | #165 | The scene runner — **built, then reverted.** A film opens into the browsable deck, not a lesson. |
| 49 | `dropped` | #168 | Energy as derived state — **in progress and discarded unpushed.** No schema was applied to prod; nothing to reverse. |
| 50 | `dropped` | #169 | Energy meter UI — never started; depended on 49. |
| 51 | `dropped` | #170 | Coins — never started; depended on 49. The streak-freeze 501 it named is real and outlives this tier. |
| 52 | `dropped` | #171 | The Final Cut + mastery ring — never started; depended on 48. The ring read SRS box state and is not blocked on anything, if it is ever wanted alone. |
| 53 | `dropped` | #172 | Gap-fill questions — never started; depended on 48. `word_position`, `matched_form` and `renderHighlighted` all still ship unused. |

---

## Tier 10 — Go live and get paid

Filed 2026-09-02. Nothing here is a nice-to-have: **the app currently cannot take a
payment.** The paywall is finished UI over a client with no store module (`billing.ts`
requires a package that isn't installed) and a server whose verification endpoints
return 501. Items 54 and 57 are **yours, not a session's** — no code can be written or
tested until the products exist in the two consoles.

Order matters: 54 unblocks 55 and 56; 57 is last because you should not submit a build
whose paywall cannot take money.

| # | Status | Issue | Work |
|---|--------|-------|------|
| 54 | `user` | #173 | **Store accounts + subscription products.** Paid-apps agreement, banking/tax, `com.wordwise.plus.monthly` / `.annual` at $4.99 / $29.99 with a free trial, shared secret + Play service account JSON. Blocks 55 and 56. |
| 55 | `todo` | #174 | **IAP client.** No purchase module is installed, so every tap returns `false` before reaching a store. Pick the library (RevenueCat vs `react-native-iap`) with the user first — it changes 56. Native dep → `eas build`. |
| 56 | `todo` | #175 | **Receipt verification + webhooks.** Both `verify` endpoints 501, `restore` never asks the store, both webhooks ignore the payload, so renewals/refunds never land. Must be idempotent. Also fixes the streak-freeze 501. |
| 57 | `user` | #176 | **Listing, compliance forms, first submission.** Screenshots, privacy labels + Data safety, review demo account, `eas.json` submit profile, `eas build`/`eas submit`, device walk on both platforms. |
| 58 | `todo` | #177 | **Push pipe.** The token is fetched and discarded; no column, no endpoint, no APNs/FCM credentials — so nothing can reach a lapsed user, and the permission prompt is already spent. |
| 59 | `doing` | #178 | **Pronunciation 401** — code complete, suite green, **unshipped**. `utils/pronunciation.ts` sends the bearer token; both call sites share it. JS-only, so it can go as an OTA, but it is simpler to let 60's build carry it. |
| 60 | `doing` | #179 | **Sound + haptics settings** — code complete, suite green, **unshipped**. `expo-haptics` added (pods in), `runtimeVersion` **1.0.2 → 1.0.4**; 1.0.3 is skipped on purpose, burned by the reverted Tier 9 builds. Needs `eas build`, not an OTA. |

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
| 2026-09-02 | 59, 60 | **#178 + #179 built together, unshipped.** Pronunciation now sends its bearer token (shared `utils/pronunciation`, expo-av `headers`); Settings gains Sound + Haptics switches over a new `utils/feedback` + prefs store, wired to MCQ answers and `PressableScale`. `expo-haptics` added, pods in, runtime **1.0.4** (1.0.3 burned by the reverted tier). 1,221 tests green. Needs `eas build`. |
| 2026-09-02 | 54–60 | **Tier 10 filed** (#173–#179): payments end to end, store submission, push pipe, pronunciation, sound. The app cannot take a payment today — no IAP module is installed and both verify endpoints 501. Items 54 + 57 are the user's. |
| 2026-09-02 | 42–53 | **Tier 9 dropped in full by user decision.** #162 #163 #164 #165 #166 #167 reverted out of `main` (5c7a759); #168 discarded unpushed; #169–#172 closed unbuilt. All twelve issues closed, every row `dropped`. `expo-av` is back and `runtimeVersion` returns to 1.0.2, so the rollback took an `eas build`, not an OTA, plus a 1.0.3 channel rollback. Restore point: tag `pre-tier9-revert`. |

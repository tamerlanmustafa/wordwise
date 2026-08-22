# Launch Queue

Ordered work queue from the 2026-08-20 issue triage. **One item per session**, top to bottom.
Run `/next-ticket` in a fresh session to pick up the next `todo` item.

Status values: `todo` · `doing` · `done` · `blocked` · `running` (shipped, still working through a backlog) · `user` (needs you, not the agent) · `dropped` (checked and not worth doing; issue closed with the evidence)

Rules for whoever works this file:
- Take the **first** item that is `todo`. Do not skip ahead, do not batch.
- Read only that item's issue. Do not re-triage, do not read the rest of the queue's issues.
- **Before writing code, validate that one item** (step 2.5 of the `next-ticket` skill): is its premise still true, is its proposed fix the right one, is it worth doing now? Evidence — a prod query, a read of the code — not opinion. Default is proceed; anything else stops and asks the user. The item's *premise* is fair game; its *position in the queue* is not.
- Mark `done` only after the verification commands in `CLAUDE.md` actually pass.
- Then **stop** and wait. Do not start the next item.

---

## Tier 1 — dated or one-line

| # | Status | Issue | Work |
|---|--------|-------|------|
| 1 | `done` | #126a | Set `LLM_COST_CAP_USD=60` on `wordwise` + `Worker` (2026-08-20, with user approval). **Raise it before item 19 (#131)** — classifying the UNKNOWN bucket adds ~$34 and would land near $76. |
| 2 | `done` | #133 | `healthcheckPath=/health` live on `wordwise` (dashboard, not `railway.json` — that file is shared with `Worker`, which binds no port). Verified green 2026-08-20. |
| 3 | `done` | #151 | Backfilled `movie_scripts.idioms` — 4,347 of 4,406 cached (2026-08-20). The 59 left are scripts with no cleaned text. |
| 4 | `done` | #104a | Arabic gated behind `preview: true` in `i18n/languages.ts` (2026-08-20). Drop the flag to un-gate after #104b. |

## Tier 2 — what user number one hits

| # | Status | Issue | Work |
|---|--------|-------|------|
| 5 | `blocked` | #124 #157 | **DISABLED in prod** — `TRANSLATION_WARM_WORKER_ENABLED=0` on `Worker` (2026-08-21, deploy `bb0fc097`) after it spent **~$219 of Google in ~13h and cached nothing**. Full diagnosis in **#157**: it re-bought the same 361 uncacheable passthrough words every ~9s, and the spend meter reads *stored* rows so it never saw a cent of it. TR hot set is **96.9% (11,393/11,754)** and effectively done; the other 11 langs sit at ~0 and were **unreachable, not merely slow** — head-of-line blocking on those 361 permanently-pending words. **Do not set the flag back to `1`** before #157 ships *and* a daily character quota exists on the Translation API. Blocked on the Google credit decision (case 74635119, ~Aug 26–28). |
| 6 | `done` | #125 | Proxy + cache TMDB server-side; key gone from the client. **Rotate the TMDB key only after the new build is adopted** — old installs and `frontend/` still carry the old one. |
| 7 | `done` | #103 | Converged all four movie CEFR derivations onto `difficulty_score`. ⏳ **Deploy is green as of 2026-08-20 (c07387c) and `/movies/by-level?level=A1` returns 200, so `prisma/manual/2026_08_20_converge_movie_cefr_issue_103.sql` is now unblocked and still UNAPPLIED.** Needs the user to run it; `movies.difficulty_level` + `ix_movies_difficulty` are still in prod. Safe to sit on — an unused column costs nothing. |
| 8 | `done` | #94 | Translation-MCQ distractors must not be near-forms of the correct answer. |
| 9 | `done` | #123 | `Cache-Control` + `ETag` on public immutable endpoints. Cloudflare Cache Rule created 2026-08-20 and verified `HIT`. Its Edge TTL is **"use cache-control if present, bypass if not"** — that setting is what keeps `/by-cefr` and `/api/tmdb/autocomplete` out of the edge. Don't change it. |
| 10 | `user` | #101 | Native-speaker review of es/pt/tr/ru. Needs real speakers. Gate on *promoting* those locales. |

## Tier 3 — correctness and latency at any user count

| # | Status | Issue | Work |
|---|--------|-------|------|
| 11 | `done` | #143 | Enrichment slow path parses a whole script (1.6–2.9s) on the event loop. Highest value in tier. |
| 12 | `done` | #129 | Sentence-worker backlog query: `NOT IN` → `NOT EXISTS`, fix the `LOWER()` index defeat. |
| 13 | `done` | #126b | Time-bound the LLM ledger `SUM()`. Split from #126. Settled/tail split in `services/llm_cost_ledger.py` — one full scan per process, index-only after. **Cap semantics unchanged**: still a lifetime total, still shared across `wordwise` + `Worker`. |
| 14 | `done` | #144 | SRS session start: batch spaCy via `nlp.pipe` + one `run_nlp` hop. Cheapest fix in the repo. |
| 15 | `done` | #145 | Lemma backfill pulls every script's full text into memory. Select two columns. |
| 16 | `done` | #148 | Enable ruff `ASYNC`. **Sequence after 11–15** so it lands green. Note in the commit that ASYNC catches none of #141–#145. |
| 17 | `done` | #134 #135 #138 #137 | **One pass, not four PRs.** Round-trip taxes on hot paths. Lemma rank backfill **APPLIED** to prod 2026-08-21 (28,154 rows, 3.7s) — `lemmas.frequency_rank` is now 100% populated. |

## Tier 4 — data quality

Sequence is load-bearing: what counts as a word → what level it is → the feed that reads it → the schema that stores it.

| # | Status | Issue | Work |
|---|--------|-------|------|
| 18 | `doing` | #96 | Recalibrate the lemma purity guard. Upstream of everything below. |
| 19 | `todo` | #131 | Give the UNKNOWN bucket (14,754 lemmas, 34.7%) an exit path. **Data pass first.** |
| 20 | `todo` | #116 | Measure then precompute the Explore candidate pool. |
| 21 | `todo` | #127 | Normalize `word_classifications` (58× duplication). **After 19**, so correct values get normalized. |
| 22 | `todo` | #104b | Finish and verify RTL. The project half of #104. |
| 23 | `todo` | #98 | Persist app language server-side + localize transactional emails. |
| 24 | `todo` | #102 | Drop `movies.script_text` (0 of 4,577 populated) and gate `POST /movies`. |

---

## Deferred — do not pick these up

**Tier 5, scaling** (revisit only after the above is clear): #149 · #150 · #128 · #136 · #132

**Tier 6, product/research** (different kind of work, not this queue): #108 · #90 · #65 · #87 · #100 · #109 · #110 · #111 · #112 · #113 · #114 · #115

⚠️ #109, #110, #111, #114 have **empty bodies**. Write two sentences each or close them.

---

## Closed in the 2026-08-20 sweep

#92 (dup of #89) · #91 (A2 81.8% → 20.2%, superseded by #131) · #105 (script text 98.8% → 1.3% empty) · #107 (dup of #108)

## Log

| Date | Item | Outcome |
|------|------|---------|
| 2026-08-21 | 17 (#134 #135 #138 #137) | Four round-trip taxes, one pass. `/srs/stats` 8 counts → 1 `GROUP BY` (verified identical on prod user 1: 162/60/54/39/7/2, 0.121ms, 2 buffers). `check_and_unlock` was worse than filed — 18 keys × SELECT+INSERT+re-read = up to **54** serialized calls — now 2 (3 cold); the ±2s `unlocked_at` heuristic that decided "newly unlocked" is gone, replaced by reading state before the write, and `/achievements/me` shares the memoized 18 defs. Upsert proved on scratch Postgres across 3 rounds: an earned badge survives progress falling back to 0 and keeps its original timestamp. JWT now decoded once per request (middleware → `scope["state"]` → dependency), mutation-checked: reverting the dependency makes the test read 4 decodes instead of 2. **#135's premise was wrong** — `check_and_unlock` has exactly one caller (`POST /achievements/check`, from the badge screen), not "every word save and review". **#137 was right problem, wrong table**: its wordfreq fallback measures 0.005ms/word (~3ms for the biggest script), so backfilling 4.83M `word_classifications` rows to delete it is a bad trade and the fallback stays. The real damage is `lemmas.frequency_rank`, which **61.3% of the new-words deck's 23,034-lemma pool lacks** while srs.py ×2 and quiz.py order by it — so the backfill targets `lemmas` (28,154 rows), as #137's own "and/or" allowed. Rank formula existed in two copies; now one `utils/word_frequency.py`. Backfill **APPLIED**: 28,154 rows in 3.7s, `lemmas.frequency_rank` 14,467 → 42,621 of 42,621, deck pool 38.7% → **100%**. |
| 2026-08-21 | 16 (#148) | `ASYNC` on, but the issue's fix was too narrow. Its two `open()` calls are the *last* three lines of `fetch_subtitle_subliminal` — `scan_video`, `download_best_subtitles` (provider HTTP, own sync client) and `save_subtitles` block ahead of them and ASYNC can't see any of it. Prod says this is the hot path, not a fallback: 4,255 of 4,409 scripts are `SUBTITLE_SRT`, newest today, and it's the *first* source `get_or_fetch_script` tries. Whole block extracted to a plain `def` behind `run_cpu` + `cpu_slot(2)`, which clears both findings without a `noqa`. The shed needed care: `Overloaded` now re-raises past both `except Exception` funnels, because returning `None` there means "no provider had this movie" and would let a busy CPU pool park a retrievable film dead (#78 again). Test asserts both halves — shed → transient, real miss → `ScriptNotFoundError`. `per-file-ignores` needs `tests/**` *and* `**/tests/**`: CI lints from `backend/`, lint-staged from the repo root. |
| 2026-08-21 | 15 (#145) | The script text was the smaller half. `POST /cefr/v2/backfill-lemmas` also read all 4.83M `word_classifications` rows (471 MB) into Prisma objects to group them in Python, then issued ~9.6M round trips writing the mappings — hours of it on the event loop, in a background task that is not offloading. All three moved into SQL: `DISTINCT ON` + `GROUP BY` return 35,650 aggregated rows, one chunked jsonb upsert writes them, and the script→movie dict became a JOIN, so `cleaned_script_text` is never detoasted. Verified equivalent on a scratch Postgres by replaying the old Python over the same data: 304 lemmas, 4,692 mappings, 0 disagreements, idempotent on re-run. `DO UPDATE` still touches only `total_movie_count`/`priority_score`, so a re-run can't undo the #91/#119 re-grades. |
| 2026-08-21 | 13 (#126b) | Every LLM call re-summed the whole ledger: 2,547 seq scans / 40.3M rows off a 17,085-row table, `ix_llm_usage_ledger_ts` used zero times. Now split at a cutoff 60s behind `now()` — older rows summed once into process memory, newer ones read live off the ts index, cutoff rolled forward each call. Prod 2.9ms/238 buffers → 0.139ms/7, seq scan gone after the one cold read per process. Still a lifetime total and still cross-process: both containers read the same tail, so neither can overspend behind the other. `GREATEST()` pins the cutoff against a backwards clock step (proved: removing it turns $3.00 into $4.00). Review caught two more — `reset()` racing a cold read undid itself, and the gloss-align fake replayed the balance on every read, which would have doubled the spend on a second cap check. |
| 2026-08-21 | 14 (#144) | Both per-word loops in `/srs/session/start` replaced by `_lemmatize_many` on `nlp.pipe`, awaited through `run_nlp`. Capped at 2 hops (due rows, then padded forms only) and 1 when the queue is full, 0 when empty. Issue's 0.63ms/word confirmed; a 10-word deck is 6.32ms → 1.77ms and now runs off the loop. Verified equivalent on all 161 real prod `user_words`: 0 disagreements vs the old function. No `nlp_slot` — same call as enrichment's bare-word lemma, shedding ~2ms of work would only cost the deck its dedupe. |
| 2026-08-20 | 12 (#129) | Only one of the issue's three points was still live. The 2.6B-row scan died with #120 (subplan is now a 2,491-buffer index-only scan), and its "use NOT EXISTS" fix is the exact rewrite that wedged the worker on 2026-07-22 — that clause stays `NOT IN`, now with an explicit `lemma_id IS NOT NULL` so the silent-idle trap isn't just a schema assumption. The real win was hidden_words: `NOT IN (SELECT LOWER(word) …)` must read all 34,095 rows to build its hash, so no index can help it; correlated, it's ~404 probes of `ix_hidden_words_word_lower`. Prod: 32–40ms → 23ms, seq scan gone. Same fragment now shared with `vocab_coverage`. |
| 2026-08-20 | 11 (#143) | Four spaCy sites in `/sentences/{word}` moved onto the NLP worker; the two whole-script ones now take an `nlp_slot(3)` and shed as `sentences_unavailable` rather than queue. Prod says the slow path is live: 1,856 of 42,594 lemmas (4.4%) have no sentence link and 238 movies have no SentenceBank at all. The issue's per-sentence loop is already dead in prod — `matched_form IS NULL` is 0 of 7.78M links — batched via `nlp.pipe` anyway. |
| 2026-08-20 | 9 (#123) | Five public movie reads now send `Cache-Control`; a new middleware adds a weak `ETag` to any 200 GET that declares a `max-age` and answers `If-None-Match` with 304. `/by-cefr` deliberately excluded — it subtracts the caller's watched/hidden films, so `public` would leak one learner's feed to the next. **The issue's premise was half wrong:** headers alone don't make Cloudflare cache. `/api/tmdb/trending` has sent `public, max-age=3600` since #125 and still returns `cf-cache-status: DYNAMIC` — the edge caches by file extension, so extensionless JSON needs a Cache Rule in the dashboard. Until then the win is device-side + 304s. |
| 2026-08-20 | 8 (#94) | Distractors that contain (or sit inside) the correct translation are filtered out of the grid. Measured on the live TR cache: 0.28% of cards swap a distractor, 0 dropped at the standard 10-card deck; only a 4-word deck can starve, ~1 card in 1,000. Edit distance deliberately rejected — it would have killed fair pairs like `comer`/`correr`. |
| 2026-08-20 | 7 (#103) | Four derivations, not two: only 61% of movies got the same level from all paths, and 418 read B1/B2/C1 at once. The enum was just the score re-bucketed lossily, so it's gone — level is derived from `difficulty_score` on read. Also fixed two silent bugs it was hiding: onboarding's first-film list 400'd for every new user, and the quiz treated every movie as B1. Column drop SQL is written but **must run after the deploy**. |
| 2026-08-20 | 6 (#125) | TMDB moved behind `/api/tmdb/*` with a single-flight TTL cache; a 20-row page is 1 request, not 20, and no key ships in the bundle. Key still hard-coded in frozen `frontend/` — rotation would break those pages. |
| 2026-08-20 | Triage | 45 → 41 open. Queue created. |
| 2026-08-20 | 2 (#133) | `/health` gate live on `wordwise`; first healthchecked deploy passed. Couldn't go in `railway.json` — shared with `Worker`, which binds no port. #133's premise was wrong: Railway healthchecks are deploy-time only, so this gates bad deploys, it does not restart a wedged process. |
| 2026-08-20 | 1 (#126a) | Cap set to $60 on both services. No deadline after all: only 2,048 lemmas left to generate (~$5 at $0.00232/call) against $12.82 headroom — the worker finishes on its own. |
| 2026-08-20 | 3 (#151) | Backfilled 4,316 scripts in 75min, 338,857 idioms, 0 failures. Prod pending 4,321 → 0; no movie now parses a script on the request path. |
| 2026-08-20 | 5 (#124) | Live and warming: TR 19,340 → 20,048, provider-tagged. Prod-only bugs found after deploy: Worker had no `DEEPL_API_KEY` (separate env from `wordwise`), a Railway var was saved as `" GOOGLE_TRANSLATE_ENABLED"` with a leading space, and the DeepL→Google handover tested `<= 0` when DeepL sat at exactly 2 spendable chars — stranding Google's 450k. Fixed in f2ae24e. |
| 2026-08-20 | 5 (#124) | Moved warming into the worker container. Found `movie_jobs` fully drained (4,328 done / 0 pending) — the movie pipeline finished, so `worker`+`controller` were idle; warming is added, nothing stopped. Also fixed: stale `DEEPL_SUPPORTED_TARGET_LANGS` (missing VI/TH/HE), Google creds unusable on Railway (wanted a file path), and Google fallback running 1-at-a-time instead of batched. |
| 2026-08-20 | 5 (#124) | Warmed TR: cache 3,204 → 19,340 rows; DeepL 87,466 → 449,998 of 500,000, reserve intact. Ran without `--tiers`, so it continued past the approved pool scope (284,224 chars) into `tail_lemmas` and spent the full 362,534 budget — pass `--tiers` explicitly next time. |
| 2026-08-20 | 5 (#124) | Built the warmer; run blocked. Prod is on **DeepL Free** (`:fx` key, no `DEEPL_PLAN`): 500k chars/month shared with live traffic, 87,466 already used. Corpus is 4,141,694 chars *per language* — 8× a full month — so #124's "pre-translate the corpus into 5 languages" is unreachable on this plan. Also: targets come from `native_language` (12 options), not the 5 UI locales. Fits today: TR at `--pool-limit 700` = 284,224 chars. |
| 2026-08-20 | 4 (#104a) | Arabic gated with a `preview` flag, not deleted — out of the picker *and* out of language resolution (an Arabic phone would otherwise auto-land in unverified RTL), while its locale files and the RTL guards stay under test. |

# Launch Queue

Ordered work queue from the 2026-08-20 issue triage. **One item per session**, top to bottom.
Run `/next-ticket` in a fresh session to pick up the next `todo` item.

Status values: `todo` · `doing` · `done` · `blocked` · `running` (shipped, still working through a backlog) · `user` (needs you, not the agent)

Rules for whoever works this file:
- Take the **first** item that is `todo`. Do not skip ahead, do not batch.
- Read only that item's issue. Do not re-triage, do not read the rest of the queue's issues.
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
| 5 | `running` | #124 | **Shipped and warming unattended** (a2a7021, f2ae24e). `translation_warm_worker` is the 4th worker process; scope is hot-set only (~874k chars/lang); DeepL then Google, `provider` column records which. TR at 20,048/23,503 (~85%). Remaining ~10 langs at ~1/month — **no action needed, just watch `/admin/health/translation-cache`**; coverage that stops climbing = worker wedged. |
| 6 | `done` | #125 | Proxy + cache TMDB server-side; key gone from the client. **Rotate the TMDB key only after the new build is adopted** — old installs and `frontend/` still carry the old one. |
| 7 | `done` | #103 | Converged all four movie CEFR derivations onto `difficulty_score`. **Run `prisma/manual/2026_08_20_converge_movie_cefr_issue_103.sql` AFTER the deploy is green, not before** — it drops a column the live client still selects. |
| 8 | `done` | #94 | Translation-MCQ distractors must not be near-forms of the correct answer. |
| 9 | `todo` | #123 | `Cache-Control` + `ETag` on public immutable endpoints. Header change, not infrastructure. |
| 10 | `user` | #101 | Native-speaker review of es/pt/tr/ru. Needs real speakers. Gate on *promoting* those locales. |

## Tier 3 — correctness and latency at any user count

| # | Status | Issue | Work |
|---|--------|-------|------|
| 11 | `todo` | #143 | Enrichment slow path parses a whole script (1.6–2.9s) on the event loop. Highest value in tier. |
| 12 | `todo` | #129 | Sentence-worker backlog query: `NOT IN` → `NOT EXISTS`, fix the `LOWER()` index defeat. |
| 13 | `todo` | #126b | Time-bound the LLM ledger `SUM()`. Split from #126. |
| 14 | `todo` | #144 | SRS session start: batch spaCy via `nlp.pipe` + one `run_nlp` hop. Cheapest fix in the repo. |
| 15 | `todo` | #145 | Lemma backfill pulls every script's full text into memory. Select two columns. |
| 16 | `todo` | #148 | Enable ruff `ASYNC`. **Sequence after 11–15** so it lands green. Note in the commit that ASYNC catches none of #141–#145. |
| 17 | `todo` | #134 #135 #138 #137 | **One pass, not four PRs.** Round-trip taxes on hot paths. |

## Tier 4 — data quality

Sequence is load-bearing: what counts as a word → what level it is → the feed that reads it → the schema that stores it.

| # | Status | Issue | Work |
|---|--------|-------|------|
| 18 | `todo` | #96 | Recalibrate the lemma purity guard. Upstream of everything below. |
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

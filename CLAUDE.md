# WordWise

## Git
- Never run `git add`, `git commit`, `git push`, or any destructive git command unless explicitly asked; instead, stage nothing and tell the user what you'd commit.

## Code reuse
- Before implementing a new feature, check for existing components, hooks, styles, and utilities that can be reused.
- If reusable code doesn't exist yet, write it in a way that can be reused — avoid duplicating logic or creating long monolithic files.

## Clarification
- Never guess or invent solutions when uncertain. Ask before proceeding.

## Mobile is the product; web is frozen
- **`apps/mobile` is the shipping app.** New features go there. Do **not** mirror them into `frontend/`, and do not maintain web/mobile feature parity — the two apps share only `packages/types`, so parity means writing every feature twice.
- **Design and test UI for both iOS and Android.** It ships on both, so account for platform differences (safe areas/notches, back gesture, status bar, fonts, shadows/elevation, haptics) and don't assume one platform's look/behavior holds on the other.
- **Account for free vs premium UI.** Features can differ by tier (gates, paywalls, upsells, limits), so check how a change looks and behaves for both free and premium users — don't build or test only one tier.
- **`frontend/` is frozen** except for the public pages the app stores require: privacy policy, terms, account-deletion request, and the landing/pricing pages. Those must stay accurate and deployable.
- The ~17 web pages that duplicate mobile features (reader, search, saved words, watched, lists, …) are **not maintained**. Leave them alone; don't fix, extend, or refactor them unless asked.
- If a task seems to need a web change, say so and ask first rather than assuming parity is wanted.

## Before making changes
- For multi-file changes or unfamiliar code, present a short plan before editing. For one-sentence changes (typo, log line, rename), just do it.
- Read the nearest existing example first and follow its patterns (naming, file layout, imports) instead of inventing new ones.
- Keep changes scoped to the task. Don't reformat or refactor unrelated lines.

## Backend concurrency: one user must never block another
- The API is a **single uvicorn process, single replica** on purpose (each holds ~1GB of ML models). Any synchronous work inside an `async def` stalls **every** concurrent request, not just the caller's. Measured: one script parse pushed `/health` from 0.16s to 7.86s.
- **The rule:** if it isn't `await`ed I/O and could exceed ~10ms, it goes through the offload helper (`run_nlp` for spaCy) — never inline. Batch first, then offload **once**; a per-item loop through the executor is worse than blocking.
- Known offenders, with measured costs: password hashing (~173ms), spaCy (~0.6ms/word, 1.6–2.9s/script), PDF/EPUB extraction, and loading a whole table to filter it in Python (see `services/hidden_words.py` for the right shape).
- **`BackgroundTasks` are not offloading.** FastAPI runs background tasks for `async def` functions *on the event loop* — they just run after the response is sent.
- **Reviewing a function in isolation cannot reveal this.** Each piece is individually correct; the defect lives in the composition. When adding to a request path, ask "what else is waiting while this runs?"
- Don't trust a green lint run here. Ruff's `ASYNC` rules only catch *known* blocking APIs (`open`, `time.sleep`, `requests`); they cannot know an ordinary function call is CPU-heavy.

## Testing (write tests as part of the feature, not after)
- When you add or change a feature, add or extend a test that covers it in the same change. New behavior shouldn't land untested.
- Put tests next to the code in a `__tests__/` folder and follow the nearest existing test's structure before inventing a new one. Jest/pytest auto-discover them.
- Mobile (`apps/mobile`): **logic + integration only — do NOT add a component-render library** (`@testing-library/react-native`). Cover features via stores, services, hooks, pure helpers, and cross-store user-story flows. Use `src/test-utils/renderHook` for hooks, and `jest.setup.js` for the shared AsyncStorage/SecureStore mocks. Watch the known gotchas: native `import()` can't run under jest, flush microtasks (not `setImmediate`) when fake timers are on, and drive dates with `jest.setSystemTime`.
- Backend: pytest under `backend/tests`. Web (`frontend/`): frozen, so no new tests — it's gated by typecheck + build only.
- The mobile jest suite + typechecks run automatically on **pre-push** (`.husky/pre-push`) and in **CI** (`.github/workflows/ci.yml`), so any test you add is exercised on every push/PR — no extra wiring needed.

## Verify your work (run before considering a task done)
- Typecheck: `npm run typecheck` (both web + mobile), or `npm run typecheck:frontend` / `npm run typecheck:mobile`.
- Lint: web → `cd frontend && npm run lint`; mobile → `cd apps/mobile && npm run lint`; backend is auto-linted by ruff on commit.
- Tests: backend → `cd backend && pytest`; mobile → `cd apps/mobile && npm test`. Prefer running a single test file over the whole suite while iterating.
- Web build sanity check (when touching the web build): `cd frontend && npm run build`.
- Show the command output as evidence rather than asserting it passed.

## Reporting back (after every fix)
- Lead with the plain-language version: what was broken and what changed, told in WordWise terms — a user tapping a word in a subtitle, the quiz deck, the sentence worker, a Railway deploy — not in function names. Two or three sentences with a concrete before/after (e.g. "a B2 word used to show up as A2 in Explore; now it sits in UNKNOWN until it's graded").
- Then go deeper **only when the detail changes something**: a decision to make, a risk, a follow-up, or prod state that differs from the repo. Otherwise skip the code tour.
- Finish with a **Concept** block so the user is learning **software engineering** from the session, not just accepting the diff:
  - **Exactly one concept. One, not three.** Pick the single most transferable thing this session taught. Skip the block entirely on trivial changes rather than padding it — one real lesson beats five labels.
  - **Aim it at a mid-level engineer trying to become senior.** Not "what this function does" but the judgement behind it: the tradeoff that was weighed, the failure mode avoided, why one design won over the obvious alternative, what a senior engineer would have asked before writing any code. Assume solid general programming ability and zero prior exposure to this particular idea.
  - Name it the way the industry names it (`idempotency`, `backpressure`, `blast radius`, `cache invalidation`, `feature flag`, `graceful degradation`) so it is searchable, then explain it in **one or two full paragraphs**. With only one concept there is room to actually teach it — use it.
  - **Go broader than the diff.** The WordWise instance is the illustration, not the lesson. Say where it showed up — a tap on a subtitle word, the quiz deck, a slow `/health` check, a Railway deploy — then generalise: where else this shows up, what it costs when ignored, how to recognise it in the next codebase. If the paragraph only makes sense to someone who has read today's diff, it is too narrow.
  - **Software engineering only**: architecture, concurrency, API and schema design, caching, indexing, failure modes, migrations, testing, ops, deploys, and the judgement around them. Not linguistics, not CEFR theory, not statistics, and never a finding about the data itself ("67% of lemmas are junk" is a result, not a concept). When the work was about data, teach the engineering underneath it — a backfill is `idempotent backfill`, a slow aggregate is `query planning`.
  - Add one `**Plainly:**` line under the paragraphs — everyday words, short clauses, the version you would say out loud to someone who has never met the term. Same idea, no new jargon.
  - Then a **Terms** list at the very end, covering **every** piece of jargon the explanation used — including the words that feel obvious to you (`payload`, `cold start`, `race condition`, `rollback`, `p99`, `event loop`, `origin`). For each term: one or two sentences of plain definition, then a concrete example from a **real, popular app or website the user already uses**.
    - Real products doing the real thing: Instagram, Netflix, Spotify, WhatsApp, Gmail, YouTube, Uber, Amazon, Google Maps. "Instagram's heart fills in the instant you tap it, before the server has confirmed anything" teaches `optimistic update`.
    - **Still no metaphors or analogies.** A real-app example is software genuinely doing the thing; a waiter, a highway, a filing cabinet or a restaurant kitchen is a comparison to something that is not software. The first is required, the second is banned.
    - If a term has no plausible real-app example, it is probably the wrong word — rewrite the sentence without it.
  - No tutorials, no code samples, no exhaustive lists. The user does their own research from the names.
  - Shape:
    ```
    ## Concept

    **blast radius** — How much of the system one change can break if it turns out to be
    wrong. It is the question a senior engineer asks before the question "is this correct?",
    because correctness is a guess and blast radius is a budget: a change that can only break
    the quiz deck ships on a Tuesday afternoon, and a change that can break every logged-in
    request does not. Today it decided the order of operations — the column drop ran *after*
    the deploy, because doing it first would have broken every client still selecting it.

    Recognising it in a new codebase is mostly about asking who reads this and when. Shared
    tables, shared config files, and anything on the login path have a large blast radius no
    matter how small the diff looks; a new screen nobody navigates to yet has almost none.

    **Plainly:** Before changing something, ask how much breaks if you are wrong. Small
    answer, just do it. Big answer, be careful and go in an order that keeps things working.

    **Terms**
    - **deploy** — Putting a new version of the server code into production so real users hit
      it. When WhatsApp suddenly has a feature you did not ask for, someone deployed.
    - **client** — Any program calling your server, usually the app on someone's phone. The
      Spotify app on an old phone that has not updated in a year is still a client, and your
      server still has to answer it.
    ```

## Deployment (Railway)
- The backend is deployed on **Railway** (`railway.json` → `docker/Dockerfile.backend`) and is live at `api.getwordwise.us`. `docker-compose.prod.yml` is not the deployed path.
- **The Railway CLI is installed** (`brew install railway`). Use it to inspect prod instead of guessing: `railway variables` reads the deployed env, `railway status` shows the linked project, `railway logs` tails the service.
- Prod config lives only in Railway's env — `DEBUG`, `JWT_SECRET_KEY`, `ALLOWED_ORIGINS`, and all API keys are **not** in the repo, so the tracked files can't tell you what prod is running.
- **`railway.json` is shared by both services.** `wordwise` and `Worker` deploy from the same file and Dockerfile, so a `deploy` block added to it applies to **both** — and `Worker` binds no port, so a `healthcheckPath` there would fail every Worker deploy. Per-service deploy settings therefore live in the dashboard: `wordwise` has `healthcheckPath=/health` plus a `prisma migrate deploy` pre-deploy command, `Worker` has `startCommand=bash scripts/start-workers.sh`.
- Railway healthchecks are **deploy-time only** — Railway polls the path until it returns 200, then stops. It never re-checks a live deployment, so a healthcheck cannot restart a wedged process; `/admin/health/event-loop` (#146) is what surfaces that.
- Auth is per-machine: if `railway whoami` returns `Unauthorized`, ask the user to run `railway login` (it opens a browser) rather than trying to authenticate.
- Read-only commands are fine unprompted. Never run `railway up`, `railway redeploy`, `railway variables --set`, or anything else that mutates the deployment without explicit approval.

## Do not touch without asking
- Never run destructive DB commands. Schema changes go through Prisma: `npm run db:migrate` (dev) — never hand-edit `backend/prisma/migrations/` or the generated Prisma client.
- Never commit or edit `.env` files; copy from `backend/env.example` and keep secrets out of the repo.
- Treat `frontend/dist/` and other generated/build output as read-only.

## Gotchas
- Shared types live in `packages/types` (`@wordwise/types`). Change types there once — don't redefine them per-app.
- Two dead web trees, neither of them the product: `web/` at the repo root is legacy `.jsx` (movies/practice/quiz/shell), and `frontend/` is the frozen React app (see "Mobile is the product"). Don't edit either for current features unless asked.
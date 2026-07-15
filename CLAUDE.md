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
- **`frontend/` is frozen** except for the public pages the app stores require: privacy policy, terms, account-deletion request, and the landing/pricing pages. Those must stay accurate and deployable.
- The ~17 web pages that duplicate mobile features (reader, search, saved words, watched, lists, …) are **not maintained**. Leave them alone; don't fix, extend, or refactor them unless asked.
- If a task seems to need a web change, say so and ask first rather than assuming parity is wanted.

## Before making changes
- For multi-file changes or unfamiliar code, present a short plan before editing. For one-sentence changes (typo, log line, rename), just do it.
- Read the nearest existing example first and follow its patterns (naming, file layout, imports) instead of inventing new ones.
- Keep changes scoped to the task. Don't reformat or refactor unrelated lines.

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

## Deployment (Railway)
- The backend is deployed on **Railway** (`railway.json` → `docker/Dockerfile.backend`) and is live at `api.getwordwise.us`. `docker-compose.prod.yml` is not the deployed path.
- **The Railway CLI is installed** (`brew install railway`). Use it to inspect prod instead of guessing: `railway variables` reads the deployed env, `railway status` shows the linked project, `railway logs` tails the service.
- Prod config lives only in Railway's env — `DEBUG`, `JWT_SECRET_KEY`, `ALLOWED_ORIGINS`, and all API keys are **not** in the repo, so the tracked files can't tell you what prod is running.
- Auth is per-machine: if `railway whoami` returns `Unauthorized`, ask the user to run `railway login` (it opens a browser) rather than trying to authenticate.
- Read-only commands are fine unprompted. Never run `railway up`, `railway redeploy`, `railway variables --set`, or anything else that mutates the deployment without explicit approval.

## Do not touch without asking
- Never run destructive DB commands. Schema changes go through Prisma: `npm run db:migrate` (dev) — never hand-edit `backend/prisma/migrations/` or the generated Prisma client.
- Never commit or edit `.env` files; copy from `backend/env.example` and keep secrets out of the repo.
- Treat `frontend/dist/` and other generated/build output as read-only.

## Gotchas
- Shared types live in `packages/types` (`@wordwise/types`). Change types there once — don't redefine them per-app.
- Two dead web trees, neither of them the product: `web/` at the repo root is legacy `.jsx` (movies/practice/quiz/shell), and `frontend/` is the frozen React app (see "Mobile is the product"). Don't edit either for current features unless asked.
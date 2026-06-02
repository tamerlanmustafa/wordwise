# WordWise

## Git
- Never run `git add`, `git commit`, `git push`, or any destructive git command unless explicitly asked; instead, stage nothing and tell the user what you'd commit.

## Code reuse
- Before implementing a new feature, check for existing components, hooks, styles, and utilities that can be reused.
- If reusable code doesn't exist yet, write it in a way that can be reused — avoid duplicating logic or creating long monolithic files.

## Clarification
- Never guess or invent solutions when uncertain. Ask before proceeding.

## WEB app versus Mobile app
- Make sure our web app is up to date with the changes/features we add to our mobile app. 
- Make sure they share the same code whenever/wherever possible to avoid writing the same code separately for each of them

## Before making changes
- For multi-file changes or unfamiliar code, present a short plan before editing. For one-sentence changes (typo, log line, rename), just do it.
- Read the nearest existing example first and follow its patterns (naming, file layout, imports) instead of inventing new ones.
- Keep changes scoped to the task. Don't reformat or refactor unrelated lines.

## Testing (write tests as part of the feature, not after)
- When you add or change a feature, add or extend a test that covers it in the same change. New behavior shouldn't land untested.
- Put tests next to the code in a `__tests__/` folder and follow the nearest existing test's structure before inventing a new one. Jest/pytest auto-discover them.
- Mobile (`apps/mobile`): **logic + integration only — do NOT add a component-render library** (`@testing-library/react-native`). Cover features via stores, services, hooks, pure helpers, and cross-store user-story flows. Use `src/test-utils/renderHook` for hooks, and `jest.setup.js` for the shared AsyncStorage/SecureStore mocks. Watch the known gotchas: native `import()` can't run under jest, flush microtasks (not `setImmediate`) when fake timers are on, and drive dates with `jest.setSystemTime`.
- Backend: pytest under `backend/tests`. Web (`frontend/`): gated by typecheck + build, not a unit runner — keep web/mobile parity per the WEB-vs-Mobile section.
- The mobile jest suite + typechecks run automatically on **pre-push** (`.husky/pre-push`) and in **CI** (`.github/workflows/ci.yml`), so any test you add is exercised on every push/PR — no extra wiring needed.

## Verify your work (run before considering a task done)
- Typecheck: `npm run typecheck` (both web + mobile), or `npm run typecheck:frontend` / `npm run typecheck:mobile`.
- Lint: web → `cd frontend && npm run lint`; mobile → `cd apps/mobile && npm run lint`; backend is auto-linted by ruff on commit.
- Tests: backend → `cd backend && pytest`; mobile → `cd apps/mobile && npm test`. Prefer running a single test file over the whole suite while iterating.
- Web build sanity check (when touching the web build): `cd frontend && npm run build`.
- Show the command output as evidence rather than asserting it passed.

## Do not touch without asking
- Never run destructive DB commands. Schema changes go through Prisma: `npm run db:migrate` (dev) — never hand-edit `backend/prisma/migrations/` or the generated Prisma client.
- Never commit or edit `.env` files; copy from `backend/env.example` and keep secrets out of the repo.
- Treat `frontend/dist/` and other generated/build output as read-only.

## Gotchas
- Shared types live in `packages/types` (`@wordwise/types`). Change types there once and consume from both web and mobile — don't redefine them per-app.
- `web/` at the repo root is legacy `.jsx` (movies/practice/quiz/shell); the live web app is `frontend/`. Don't edit `web/` for current features unless asked.
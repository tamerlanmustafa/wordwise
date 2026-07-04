# WordWise — Launch Roadmap (your side)

> Companion to [DEPLOYMENT.md](DEPLOYMENT.md). The repo-side prerequisites are **done**
> (2026-07-03): backend Dockerfile, Prisma migration baseline, `eas.json` +
> `runtimeVersion`, TMDB key rotation, deploy workflow reads secrets.
> This file is the checklist of steps only *you* can do — accounts, secrets,
> DNS, store registration. Work top to bottom; A → C are sequential,
> D can start in parallel today.

Chosen setup (option 2): **Railway** (backend, usage-based ~$20–40/mo) +
**Cloudflare free** (edge/TLS) + **EAS free** (mobile builds) + GitHub Pages
(web, already wired). Expected all-in: **~$30–60/mo** + $99/yr Apple + $25 Google.

---

## A. GitHub Actions secret — do this first (5 min)

The web deploy workflow no longer contains a hard-coded TMDB key; it reads a
repo secret. Until you add it, a Pages deploy builds with an **empty** key.

- [ ] GitHub repo → **Settings → Secrets and variables → Actions** → *New repository secret*
  - Name: `VITE_TMDB_API_KEY`
  - Value: the current key (see `TMDB_API_KEY` in `apps/mobile/src/config/env.ts`)
- [ ] (Optional, only if the API URL ever differs from `https://api.wordwise.app`)
  add a repository **variable** `VITE_API_URL` — the workflow falls back to
  `https://api.wordwise.app` when unset.

## B. Railway — backend hosting + CD (~1 hour)

- [ ] Sign up at [railway.app](https://railway.app) with GitHub; choose the **Pro** plan ($20/mo minimum, usage-based).
- [ ] **New project** → **Deploy from GitHub repo** → select this repo.
- [ ] Add **PostgreSQL** to the project (right-click canvas → Database → PostgreSQL).
- [ ] Configure the first service as the **API**:
  - Settings → Build → **Dockerfile path**: `docker/Dockerfile.backend` (root directory stays the repo root).
  - Region: **US-East** (balanced global default; pick EU-West if early users skew European). Keep **all services + DB in the same region**.
  - Memory: ~**1 GB**. Health check path: `/health`.
  - **Pre-deploy command**: `python -m prisma migrate deploy --schema=prisma/schema.prisma`
  - Start command: leave default (the image CMD runs uvicorn on `$PORT`).
- [ ] Add a **second service** from the same repo — the **worker**:
  - Same Dockerfile path.
  - **Custom start command**: `bash scripts/start-workers.sh`
  - **No public networking** (remove the domain/port). Memory: ~**2 GB**.
- [ ] Set **environment variables on both services** (Variables tab; use a shared variable group if offered):
  | Variable | Value |
  |---|---|
  | `DATABASE_URL` | reference the Postgres service (`${{Postgres.DATABASE_URL}}`) |
  | `JWT_SECRET_KEY` | freshly generated: `openssl rand -hex 32` — do NOT reuse the example value |
  | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud Console (same project as the mobile OAuth client) |
  | `ANTHROPIC_API_KEY` | your key (spend already ledger-capped at $50) |
  | `TMDB_API_KEY` | the current key |
  | Google Translate / `STANDS4_*` creds | as in `backend/env.example` |
  | `ALLOWED_ORIGINS` | your web origin(s), e.g. the GitHub Pages URL |
  | `DEBUG` | `False` |
- [ ] Trigger the first deploy and **watch the build logs** — this is the
  Dockerfile's first real build (Docker isn't installed locally, so it has
  never been exercised; expect possibly one round of fixes).
- [ ] After the API is green, seed the achievement definitions **once**
  (idempotent): `psql "$DATABASE_URL" -f backend/prisma/migrations_manual/2026_07_03_scaffold_tables.sql`
- [ ] Sanity: from now on, **merging to main auto-deploys the backend**. CI
  (`ci.yml`) still gates PRs; Railway's pre-deploy runs migrations.

## C. Domain + Cloudflare (~30 min)

- [ ] **Confirm you own `wordwise.app`** — the mobile app hard-codes
  `https://api.wordwise.app` in production (`apps/mobile/src/config/env.ts`).
  If you don't own it, buy it (or pick another domain and update `env.ts` +
  the `VITE_API_URL` repo variable before shipping binaries).
- [ ] Add the domain to **Cloudflare** (free plan) and switch nameservers at your registrar.
- [ ] Railway → API service → Settings → Networking → **Custom domain** `api.wordwise.app`; create the CNAME Cloudflare shows, **proxied** (orange cloud).
- [ ] Smoke-test from a real device/browser: `https://api.wordwise.app/health`, then auth + Google sign-in + a movie vocabulary fetch against prod.
- [ ] (Later, optional win) Cloudflare **cache rules** for the static-ish GET
  endpoints (movie vocabulary/CEFR) once they send `Cache-Control` headers —
  biggest latency win for the global audience.

## D. App store accounts — start today, approval takes days

- [ ] **Apple Developer Program** — $99/yr, [developer.apple.com](https://developer.apple.com). Identity verification can take 1–2 days.
- [ ] **Google Play Console** — $25 one-time, [play.google.com/console](https://play.google.com/console). Verification can also take days.
- [ ] `npm i -g eas-cli && eas login` (Expo owner: `tamerleinn`; project already linked in `app.json`).
- [ ] Verify the **production Google OAuth client**: iOS client matches bundle id `com.wordwise.mobile`; add the **SHA-1 of the Android release keystore** (EAS manages the keystore — `eas credentials` shows it) in Google Cloud Console; backend `GOOGLE_CLIENT_ID` matches.
- [ ] Once the API is live (end of C): `eas build --platform all --profile production`
- [ ] `eas submit --platform all` → TestFlight + Play internal testing → QA on real devices → submit for review.
- [ ] JS-only hotfixes between store releases: `eas update --channel production`.

## E. Local dev database — one-time (5 min)

Your local DB predates the migration history, so mark the baseline as applied
(fresh databases skip this — `migrate deploy` handles them):

- [ ] `cd backend && prisma migrate resolve --applied 20260703000000_init`
- [ ] Going forward use `npm run db:migrate` (creates history), **not** `db:push`.

---

## Follow-ups to queue (not launch blockers)

- **Proxy TMDB through the backend** so the client key stops shipping in app bundles (rotation done; this is the durable fix).
- **Persist the worker's seed cursor to the DB** — `.seed_cursor.json` lives on the container filesystem and resets every deploy (harmless/idempotent, but re-walks TMDB discover).
- **Cache-Control headers** on the cacheable GET endpoints + Cloudflare cache rules (see C).
- Open security items: store **webhook signature validation** (Apple/Google billing), **refresh-token revocation** (jti denylist), bump the yanked `requests==2.32.0` pin to 2.32.3+.
- Watch as you grow: Railway usage dashboard, Google Translate character count, Anthropic ledger, Cloudflare cache-hit ratio (§8 of DEPLOYMENT.md).

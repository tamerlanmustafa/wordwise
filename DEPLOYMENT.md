# WordWise — Deployment Plan (Mobile App + Backend)

> **Scope:** Shipping the **mobile app** (Expo / React Native) to the App Store + Google Play, and hosting the **backend it depends on** so the app actually works. The web frontend (`frontend/`) is intentionally **out of scope for now**.
>
> **Profile used for these recommendations** (from project owner):
> - **Stage:** Pre-launch / MVP (low traffic)
> - **Budget/ops:** Balanced — reasonable cost, low DevOps effort, prefer managed platforms
> - **Audience:** Global / worldwide
> - **Infra control:** Minimize DevOps
>
> _Researched June 2026. Prices change — treat the numbers as planning estimates, not quotes._

---

## 0. The one critical thing about "mobile-only" deployment

A mobile app is **not self-contained**. The Expo app talks to your FastAPI API (`apps/mobile/src/config/env.ts` already hard-codes the production base URL `https://api.wordwise.app`). So "deploy the mobile app online" really means **two** deliverables:

1. **Host the backend** (FastAPI API + background worker + PostgreSQL) at a public HTTPS domain — *this is where the cloud env / services / cost / region decisions live.*
2. **Build & distribute the mobile binaries** via Expo EAS to the two app stores, plus OTA updates.

You cannot skip #1. The rest of this doc covers both.

---

## 1. TL;DR — Recommended route

| Layer | Recommendation | Why | Est. cost (MVP) |
|---|---|---|---|
| **Backend API + Worker** | **Railway** (Pro plan, usage-based) | Lowest-DevOps path for a multi-service Docker app (API + worker + DB in one project, one bill, deploy from Git). | ~$20–40/mo |
| **PostgreSQL** | **Railway-managed Postgres** (start here) → migrate to **Neon** if DB cost grows | One bill + zero setup for MVP; Neon's scale-to-zero saves money later. | included / ~$0–19/mo |
| **Redis** | **Skip for MVP** (the job queue uses Postgres, not Redis) → **Upstash** free tier if/when needed | `REDIS_URL` is optional in this codebase; don't pay for what you don't use. | $0 |
| **Edge / global latency** | **Cloudflare** in front of `api.wordwise.app` (free plan) | Global audience: TLS, DDoS protection, and **caching of the static-ish movie-vocabulary GETs** at the edge — biggest single latency win for a worldwide user base on a single-region backend. | $0 |
| **Mobile build & ship** | **Expo EAS** (Free tier → Starter $19/mo when you outgrow it) | Cloud iOS/Android builds + store submission + OTA updates, no Mac/CI to manage. | $0–19/mo |
| **App store accounts** | Apple Developer + Google Play | Mandatory to publish. | $99/yr + $25 once |
| **Translation API** | **Google Cloud Translation** (default), keep DeepL optional | 500K chars/mo free, then ~$20/M; broadest language coverage for a global audience. | $0 → usage |
| **LLM (example sentences)** | **Anthropic**, already hard-capped | `LLM_COST_CAP_USD=50` ledger gate is already in the code. | ≤ $50/mo (capped) |

**Realistic all-in MVP run-rate: ~$30–60/month** + **$99/year** (Apple) + **$25 one-time** (Google), before external-API usage. Detailed breakdown in §8.

**If you'd rather have a flat, predictable bill than usage-based:** use **Render** instead of Railway (see §4) — simpler mental model, ~$50–75/mo.

---

## 2. What we're actually deploying (from the codebase)

| Component | Tech | Deploy shape |
|---|---|---|
| **API** | FastAPI + Uvicorn (`backend/src/main.py`), Prisma (Python) → Postgres | Long-running container, public HTTPS |
| **Background worker** | `python -m src.workers.worker` + `controller` (`backend/src/workers/Procfile`); raw-SQL job queue over `asyncpg` + token-bucket rate limiter | Long-running container (no public port) |
| **Database** | PostgreSQL 15, schema via Prisma (`backend/prisma/schema.prisma`) | Managed Postgres |
| **Cache/queue** | Redis — **optional** (`REDIS_URL` optional; queue lives in Postgres) | Skip for MVP |
| **Heavy ML** | spaCy `en_core_web_sm`, `sentence-transformers` (`all-MiniLM-L6-v2` → pulls torch), scikit-learn, NLTK, wordfreq | Bundled in the backend image; **see §3** |
| **Mobile app** | Expo SDK 54 / RN 0.81, native modules (Google Sign-In), `ios/` + `android/` present | EAS Build → App Store / Play Store |

### Important nuance: the ML is *lazy-loaded*
Every heavy import (`import spacy`, `from sentence_transformers import …`, `sklearn`) is **inside a function**, not at module top level. `main.py`'s startup only does `connect_db()`. Consequences:

- The **API process boots light** and only pulls torch/spaCy/MiniLM into RAM **when a classification endpoint is actually hit**. Once loaded, expect the process to sit around **~1–1.5 GB** resident.
- The **bulk of the heavy work** (TMDB seeding, script ingestion, CEFR classification, embeddings) happens in the **worker**, which auto-seeds popular films on startup. The worker is the memory-hungry one: size it at **~2 GB**.
- The mobile app mostly **reads already-classified vocabulary** out of Postgres — relatively cheap, cache-friendly requests.

This is *why* a managed container PaaS fits and serverless does not (next section).

---

## 3. Why not "serverless" (Lambda / Cloud Run scale-to-zero / Vercel functions)

Tempting for an MVP, but a poor fit here:

- **Image size & cold starts.** torch + sentence-transformers + spaCy model + NLTK data is a multi-GB image. Serverless cold starts that load these models are slow (multi-second), and several function platforms cap build/runtime memory (e.g. Vercel build OOMs on `sentence-transformers`).
- **A persistent background worker** that loops forever and seeds a catalog does not map onto request-scoped functions.
- **Stateful model loading.** You want the model resident in a warm process, not reloaded per invocation.

**Conclusion:** use an **always-on container PaaS** (Railway / Render / Fly), with the API and worker as two services sharing one image. GPUs are **not** needed — MiniLM embeddings and spaCy run fine on CPU.

---

## 4. Backend hosting — platform comparison (2026)

All three support custom Docker images and long-running services. Differences that matter here: pricing model, memory ceiling, and global reach.

| | **Railway** ⭐ recommended | **Render** (predictable alt) | **Fly.io** (global alt) |
|---|---|---|---|
| **Pricing model** | Usage-based, billed by the second; plan = monthly minimum | Flat plan + compute add-ons | Usage-based; multiple meters compound |
| **Entry plans** | Hobby $5/mo, **Pro $20/mo** (min) | Hobby $0 + compute, **Pro $25/mo** + compute | ~$5/mo minimum |
| **Service sizing for this app** | Pick RAM/CPU per service; pay for what's used | Web **Standard $25 (2 GB)**, Worker $25 (2 GB); Starter $7 = 512 MB is **too small** for the ML lazy-load | Choose VM size per Machine |
| **Multi-service project (API+worker+DB)** | First-class, one project, one bill | Supported (separate services) | Supported (separate apps/processes) |
| **Managed Postgres** | Yes, in-project | Render Postgres (Basic ~$6 → Standard ~$19) | Fly Postgres (you run it) |
| **Managed Redis** | Yes, in-project | Key-Value **from $10/mo (25 MB)** | Upstash add-on |
| **Global regions** | US-West, US-East, EU-West, SE-Asia (pick one) | Oregon, Ohio, Virginia, Frankfurt, Singapore (pick one) | **30+ edge regions, easiest true multi-region** |
| **DevOps effort** | **Lowest** | Low | Medium (more knobs, "surprise bill" reports) |
| **Best when** | Variable/low MVP traffic, want one simple bill | You want a **flat, predictable** monthly number | You need multi-region close-to-user latency *now* |

### Recommendation: **Railway** for the MVP
- One project holds **API service + worker service + Postgres**, deployed straight from the Git repo (Dockerfile or Nixpacks), one dashboard, one bill.
- Usage-based billing suits pre-launch traffic that's mostly idle — you're not paying for a 2 GB box 24/7 if it's barely used.
- Set the **worker** to ~2 GB and the **API** to ~1 GB; scale later.

**Choose Render instead if** a fixed invoice matters more than squeezing cost — but note Render's small plans (512 MB) won't hold the ML libs, so you're effectively on Standard ($25) services, and it adds up faster than Railway for an idle MVP.

**Revisit Fly.io when** you have real global traffic and single-region latency becomes the complaint — Fly makes multi-region the simplest. Until then it's more ops than your "minimize DevOps" goal wants.

---

## 5. Database & cache

### PostgreSQL
- **Start:** the **platform's managed Postgres** (Railway/Render) — zero extra setup, same dashboard, same bill. Best for "minimize DevOps."
- **Grow into Neon** if DB cost/scaling becomes a factor: Neon free tier = 100 CU-hours + 0.5 GB with **scale-to-zero** (you pay only when active); storage dropped to ~$0.30/GB-mo in 2026. Caveats with Neon + Prisma + a long-running worker:
  - Use Neon's **pooled connection string** (PgBouncer) for the API; the worker holds its own `asyncpg` pool.
  - Scale-to-zero adds a **cold-start delay on the first query** after idle — fine for an MVP, but the always-on worker will mostly keep it warm anyway.
- **Supabase** is overkill here — you already have your own auth (JWT + Google OAuth) and don't need its auth/storage/realtime bundle; its free project also **pauses after 7 days idle**.

**Migrations:** the repo currently leans on `prisma db push` (dev). For production, adopt a migration history and run **`prisma migrate deploy`** on release (the root `package.json` already exposes `db:migrate`). Never hand-edit `backend/prisma/migrations/` (per `CLAUDE.md`).

### Redis — skip for MVP
The job queue is **Postgres-backed** (`asyncpg`, `backend/src/workers/queue.py`), and `REDIS_URL` is **optional** in config. There's a new untracked `backend/src/utils/rate_limit.py` — confirm whether it requires Redis before launch. If it does and you want distributed rate-limiting, add **Upstash Redis** (free: 256 MB / 500K commands/mo; then $0.20 per 100K commands) rather than a $10/mo Render Key-Value instance.

---

## 6. Global audience strategy (single-region backend + edge)

A worldwide audience on a single-region PaaS means users far from that region eat round-trip latency. Pragmatic MVP approach:

1. **Pick one central region** for the API + worker + DB:
   - Balanced global default: **US-East (Virginia)**.
   - If early users skew European: **Frankfurt (EU)**.
   - Keep API, worker, and DB in the **same region** (DB round-trips dominate).
2. **Put Cloudflare in front of `api.wordwise.app`** (free plan):
   - Global TLS, DDoS protection, HTTP/3.
   - **Edge-cache the cacheable GETs.** Movie/vocabulary/CEFR responses are effectively static per movie — caching them at Cloudflare's edge serves most of the world from a nearby PoP and slashes load on your single origin. Add `Cache-Control` headers on those endpoints; keep auth/user-specific endpoints `private, no-store`.
3. **Defer multi-region** until traffic + analytics justify it. When it does, Fly.io (read replicas near users) or a second Railway/Render region is the move.

> Mobile-specific bonus: app **binaries and OTA updates** are already globally distributed by the App Store / Play Store CDNs and EAS's edge (100 GiB egress on the free tier) — so the only thing you're responsible for globally is the **API**, which Cloudflare handles.

---

## 7. Mobile distribution (Expo EAS → App Store + Play Store)

The app uses **native modules** (`@react-native-google-signin/google-signin`) and has committed `ios/` + `android/` dirs, so **Expo Go won't run it** — you need EAS Build (or a local dev client).

### 7.1 Expo EAS plans (2026)
| Plan | Price | Includes |
|---|---|---|
| **Free** | $0 | 15 iOS + 15 Android builds/mo, OTA to **1,000 MAU**, 100 GiB edge bandwidth |
| **Starter** | $19/mo | $45 priority-build credit |
| **Production** | $199/mo | $225 build credit, 50,000 MAU OTA, 1 TiB bandwidth |

➡️ **Start on Free.** 15 builds/platform/month is plenty for pre-launch, and 1,000 MAU of OTA covers an MVP. Move to **Starter ($19)** only when you want priority builds or hit build limits. Production ($199) is a scale concern, not an MVP one.

### 7.2 Mandatory store accounts (paid to Apple/Google, **not** Expo)
- **Apple Developer Program — $99/year.** Required to ship to TestFlight and the App Store.
- **Google Play Developer — $25 one-time.** Required to publish on Play.
- EAS **Submit** uploads your builds to both; it does not charge the platform fees.

### 7.3 What to set up in the repo before first build
- **Create `apps/mobile/eas.json`** — it's currently empty/missing. Define `development`, `preview`, and `production` build profiles + the `submit` config. Example skeleton:
  ```jsonc
  {
    "cli": { "version": ">= 12.0.0" },
    "build": {
      "development": { "developmentClient": true, "distribution": "internal" },
      "preview":     { "distribution": "internal" },
      "production":  { "autoIncrement": true }
    },
    "submit": { "production": {} }
  }
  ```
- **Set `runtimeVersion`** in `app.json` (e.g. `{"policy": "appVersion"}`) so EAS Update only ships OTA JS to compatible binaries.
- **App store identity is already configured:** `ios.bundleIdentifier = com.wordwise.mobile`, `android.package = com.wordwise.mobile`, EAS `projectId` present, owner `tamerleinn`. Good — reuse these.
- **Point production at the real API.** `apps/mobile/src/config/env.ts` already targets `https://api.wordwise.app` for prod — make sure DNS + Cloudflare + the backend actually serve that hostname before submitting.
- **Google Sign-In:** the iOS URL scheme/client ID is embedded in `app.json`. Verify the **production** OAuth client (and `GOOGLE_CLIENT_ID` on the backend) matches the released bundle ID, and add the SHA-1 for the Android release keystore in Google Cloud Console.

### 7.4 Release flow (per release)
1. `eas build --platform all --profile production` (cloud builds iOS + Android).
2. `eas submit --platform all` (uploads to App Store Connect + Play Console).
3. Submit for review (Apple ~1–2 days; Google a few hours–days).
4. Ship JS-only fixes between store releases with **`eas update`** (OTA), respecting `runtimeVersion`.

---

## 8. Cost estimation (MVP, monthly)

### Recommended path — Railway + EAS Free + Cloudflare
| Item | Estimate |
|---|---|
| Railway Pro (API ~1 GB + Worker ~2 GB, low traffic, usage-based) | **$20–40/mo** |
| Railway-managed Postgres (small) | included in usage / ~$5–10 |
| Redis | $0 (skipped) |
| Cloudflare (free plan) | $0 |
| Expo EAS (Free tier) | $0 |
| Google Cloud Translation (≤ 500K chars/mo free) | $0 → usage |
| Anthropic example sentences (capped) | ≤ $50 (hard cap, typically far less) |
| **Recurring subtotal** | **≈ $30–60/mo** |
| Apple Developer | **$99/year** (~$8/mo amortized) |
| Google Play | **$25 one-time** |

### Predictable alternative — Render
| Item | Estimate |
|---|---|
| Render Web (Standard, 2 GB) | $25 |
| Render Background Worker (2 GB) | $25 |
| Render Postgres (Basic→Standard) | $6–19 |
| Cloudflare / EAS Free | $0 |
| **Recurring subtotal** | **≈ $55–75/mo** |

> **External-API usage is the variable you watch as you grow**, not the hosting. Google Translate is ~$20 per million characters after the free 500K; the README estimates enrichment at **~$0.15/movie/language**; Anthropic is already ledger-capped at `LLM_COST_CAP_USD=50`. TMDB is free; STANDS4 has a free tier. Because translations are **cached** (`TranslationCache` table) and classification is precomputed by the worker, per-user marginal cost stays low.

---

## 9. Prerequisites & gaps to close before you can deploy

These are real blockers found in the repo:

1. **Missing backend Dockerfile.** `docker-compose.prod.yml` and the README reference `docker/Dockerfile.backend` + `docker/Dockerfile.frontend`, but **no Dockerfiles exist** in the repo. You need a production **backend** Dockerfile that:
   - installs `requirements.txt`,
   - runs `prisma generate`,
   - **bakes in model assets at build time** so they aren't downloaded on every cold start: `python -m spacy download en_core_web_sm`, NLTK data (`wordnet`, `omw-1.4`, `punkt`, `stopwords`), and pre-fetches the `all-MiniLM-L6-v2` sentence-transformer.
   - (Frontend Dockerfile is **not needed** under the mobile-only scope.)
2. **`eas.json` is empty/missing** — add build + submit profiles (§7.3).
3. **`runtimeVersion`** not set in `app.json` — needed for safe OTA updates.
4. **Secrets:** set `DATABASE_URL`, `JWT_SECRET_KEY` (rotate the example value), `GOOGLE_CLIENT_ID/SECRET`, `ANTHROPIC_API_KEY`, translation creds, `STANDS4_*`, `ALLOWED_ORIGINS` as **platform environment variables** — never commit `.env` (per `CLAUDE.md`).
5. **`DEBUG=False`** in production; restrict `ALLOWED_ORIGINS` (mobile native requests send no `Origin`, so this mainly guards any browser callers).
6. **DB migrations:** switch from `prisma db push` to a committed migration history + `prisma migrate deploy` on release.
7. **Health check:** `/health` already exists — wire it to the platform's health-check + Cloudflare uptime.
8. **Worker scaling for MVP:** the worker auto-seeds the TMDB catalog on start. Decide whether to run it **always-on** (continuously grows catalog) or **burst it** to build an initial catalog, then scale to a single small instance to save money.
9. **Known security gaps** flagged in prior review (access-control/IDOR on some endpoints, fail-open discount/consumables) should be triaged **before** a public launch — see the project security-scan notes.

---

## 10. Recommended rollout sequence

1. **Write the production backend Dockerfile** (bake in spaCy/NLTK/MiniLM assets) and verify it boots locally with `DEBUG=False`.
2. **Provision Railway project:** Postgres + API service + worker service from the repo; set env vars; run `prisma migrate deploy`.
3. **Buy the API domain + add Cloudflare**, point `api.wordwise.app` at the Railway service, enable TLS + caching rules for the static GET endpoints.
4. **Smoke-test the API** end-to-end (auth, Google OAuth, movie vocabulary, translation) from a device against the prod URL.
5. **Register Apple Developer ($99/yr) + Google Play ($25)**; create app records (bundle/package already set).
6. **Add `eas.json` + `runtimeVersion`;** `eas build --profile production --platform all`.
7. **`eas submit`** to TestFlight + Play internal testing; QA on real devices.
8. **Submit for review;** launch. Use `eas update` for JS hotfixes between store releases.
9. **Watch:** Railway usage, Google Translate character count, Anthropic ledger, Cloudflare cache-hit ratio. Scale the worker / add a second region only when the data says so.

---

## Sources

**Backend PaaS (Railway / Render / Fly.io):**
- [Railway vs Render — Northflank (2026)](https://northflank.com/blog/railway-vs-render)
- [Railway vs Render vs Fly.io — TECHSY (2026)](https://techsy.io/en/blog/railway-vs-render-vs-fly-io)
- [Railway vs Render vs Fly.io for Solo Developers (2026)](https://devtoolpicks.com/blog/railway-vs-render-vs-fly-io-solo-developers-2026)
- [Render vs Railway — Encore (2026)](https://encore.dev/articles/render-vs-railway)
- [Platforms with a real free tier — Render (2026)](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026)

**Deploying ML-heavy FastAPI:**
- [Deploying Sentence Transformers as a service — Zilliz](https://zilliz.com/ai-faq/how-do-you-deploy-a-sentence-transformer-model-as-a-service-or-api-for-example-using-flask-fastapi-or-torchserve)
- [Out of memory building FastAPI with sentence-transformers — Vercel Community](https://community.vercel.com/t/out-of-memory-when-building-fastapi-app-with-sentence-transformers/25610)
- [How to Deploy ML Solutions with FastAPI, Docker, and GCP — Towards Data Science](https://towardsdatascience.com/how-to-deploy-ml-solutions-with-fastapi-docker-and-gcp-de1bb8bfc59a/)

**Managed Postgres (Neon / Supabase):**
- [Neon vs Supabase 2026 — closefuture.io](https://www.closefuture.io/blogs/neon-vs-supabase)
- [Neon Serverless Postgres Pricing 2026 — simplyblock](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)
- [Database Pricing Comparison (2026) — buildmvpfast](https://www.buildmvpfast.com/api-costs/database)

**Managed Redis (Upstash):**
- [Upstash Redis Pricing](https://upstash.com/pricing/redis)
- [Upstash Pricing & Limits — docs](https://upstash.com/docs/redis/overall/pricing)

**Expo EAS + store fees:**
- [Expo Application Services Pricing](https://expo.dev/pricing)
- [Expo Subscriptions, plans, and add-ons — docs](https://docs.expo.dev/billing/plans/)
- [Expo EAS Pricing Explained (2026) — RNPush](https://rnpush.com/blog/expo-eas-pricing-explained)

**Translation APIs:**
- [Translation API Pricing Comparison (2026) — buildmvpfast](https://www.buildmvpfast.com/api-costs/translation)
- [DeepL vs Google Cloud vs Azure Translator (2026) — ChatsControl](https://chatscontrol.com/blog/deepl-api-vs-google-cloud-vs-azure-translator-comparison)

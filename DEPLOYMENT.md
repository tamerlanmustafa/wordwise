# WordWise — Mobile App Launch Plan

> **Scope:** everything that stands between today and the **mobile app** (Expo /
> React Native) being live on the **App Store + Google Play**. The backend it
> depends on is **already deployed and live** (Railway + Cloudflare). The web
> frontend (`frontend/`) is **out of scope** — it is not deployed and is not
> required to ship mobile.
>
> Consolidated 2026-07-12 from the old `DEPLOYMENT.md` (pre-launch infra plan)
> and `DEPLOYMENT_ROADMAP.md` (post-deploy roadmap). The infra-provisioning
> steps those described — pick a PaaS, write the Dockerfile, migrate the DB,
> wire DNS — are **done**; the full pre-deploy history lives in git.
>
> Items marked **[Claude]** are in-repo code changes I can make; **[You]** are
> dashboard/account actions only you can do.

---

## ✅ Where we are (verified live, 2026-07-07)

| Piece | Status |
|---|---|
| **Backend API** | Live at `https://api.getwordwise.us` (Railway + Cloudflare proxy, Full SSL, 133 routes, ~150ms) |
| **PostgreSQL** | Railway-managed; Prisma migration baseline applied via pre-deploy command; **all local data imported & verified** (50k sentence bank, 89k lemma links, 5k classifications); sequences fixed |
| **Worker** | Deployed (`bash scripts/start-workers.sh`); initial catalog seeded (≈3,788 films). Scaling mode decided — **burst → tiny always-on** (§4.5) |
| **Domain** | `getwordwise.us` on Cloudflare (free), `api.` CNAME proxied, TLS Full — no redirect loops, verified |
| **Mobile config** | `apps/mobile/eas.json` (dev/preview/production profiles + submit), `runtimeVersion: {policy: appVersion}`, prod URL `api.getwordwise.us` in `src/config/env.ts`; EAS CLI installed, logged in as `tamerleinn` |
| **Store accounts** | Apple Developer **active**; Google Play created (developer name: GetWordWise) |
| **CI** | Green (backend, frontend, mobile, schema jobs on every push) |

So the backend is done. **What remains is entirely mobile-app + launch work**, in the five phases below.

---

## Phase 1 — Finish the build pipeline (this week)

Goal: an installable build on a real phone, talking to prod.

- [ ] **[You]** Android preview build: `cd apps/mobile && eas build --platform android --profile preview`. Say **Yes** to "Generate a new Android Keystore". Install the APK on a phone and smoke-test movies/vocab against prod.
- [ ] **[You]** Register the release keystore's SHA-1 for Google Sign-In: `eas credentials` (Android → production → Keystore) → copy **SHA-1** → Google Cloud Console → the Android OAuth client for `com.wordwise.mobile` → add fingerprint. *Until this is done, Google login fails on EAS builds.*
- [ ] **[You]** iOS build (Apple account active): `eas build --platform ios --profile preview`. Let EAS manage certificates. Test via TestFlight internal.
- [ ] **[You]** Recruit **~12 friends/testers now** for Google Play closed testing. New personal Play accounts must run a closed test (12 testers for 14 consecutive days) **before Google grants production access**. This is the **longest pole in the whole launch** — start the clock ASAP. Apple has no equivalent gate.

---

## Phase 2 — Store-rejection blockers (fix BEFORE submitting)

Each is a known, common rejection reason. Verified against the codebase 2026-07-07 — none exist yet.

### 2.1 Account deletion — **Apple hard requirement** (Guideline 5.1.1(v))
Apps with account creation **must** let users delete the account in-app. Google Play additionally requires a **public web link** to request deletion (goes in the Data Safety form — see 2.5).
- [ ] **[Claude]** Backend: `DELETE /auth/me` — deletes the user row (cascades already exist on user-owned tables) after re-auth/confirmation.
- [ ] **[Claude]** Mobile: "Delete account" action in the profile sheet (`UserMenuSheet`), with confirm dialog.

### 2.2 Sign in with Apple — **Apple requirement when Google Sign-In is present** (Guideline 4.8)
The app offers Google Sign-In, so Apple requires an equivalent privacy-focused option. Email/password does **not** satisfy 4.8.
- [ ] **[Claude]** Add `expo-apple-authentication` (iOS-only button), backend verification of Apple identity tokens (mirror `google_auth.py`), `apple_id` column via Prisma migration.
- [ ] Estimate ~half a day. Skipping it risks a 4.8 rejection on first review.

### 2.3 In-app purchases — decide now: ship v1 FREE or finish billing
The paywall/billing surface exists (`billing.py`: apple/google verify, restore, webhooks) but the June security scan flagged **receipt validation & webhook signatures as stubbed**, and consumables as fail-open. A live paywall taking money without server-verified receipts = revenue loss + store trouble.
- [ ] **Decision:** launch v1 with premium **feature-flagged OFF** (fastest, recommended — the `feature_flags` table exists for exactly this), **or**
- [ ] implement real StoreKit2 / Play Billing receipt validation + webhook signature verification (Apple `signedPayload` JWS, Google Pub/Sub) before launch. *If the paywall is visible in the binary, reviewers will test it.*

### 2.4 Review-pass essentials
- [ ] **[Claude]** `ITSAppUsesNonExemptEncryption: false` in `app.json` `ios.infoPlist` (app only uses HTTPS — skips the export-compliance interrogation on every upload).
- [ ] **[You]** **Demo account** for reviewers: create a prod account (e.g. `review@getwordwise.us` / strong password), pre-populate with a movie + saved words, put credentials in App Review notes on **both** stores. Login-gated apps without demo creds get rejected same-day.
- [ ] **[Claude]** **TMDB attribution:** TMDB's API terms require "This product uses the TMDB API but is not endorsed or certified by TMDB" + logo, on the app's settings/about screen. Poster-heavy apps get flagged for this.
- [ ] **[You]** Copyright prep: the app shows movie scripts/subtitles. Have a ready answer for review ("educational fair-use excerpts, vocabulary learning context"); expect Apple may push back. Worst case, sentence-length *excerpts* are far safer than full scripts.
- [ ] **[You]** Data Safety form (Play) + Privacy Nutrition Labels (Apple): declare email, name, Google ID, usage data; no ads SDK; data deletable via 2.1.
- [ ] **[You]** Age-rating questionnaires (both stores). Movie content → likely 12+/Teen; answer honestly, mismatches cause rejection.

### 2.5 Public privacy-policy, terms & deletion URLs (store forms require them)
Both stores require **public URLs** for privacy policy and terms; Play also needs the account-deletion request URL from 2.1. These do **not** require deploying the web app — you only need **three static pages** reachable at a public URL.
- [ ] **[You]** Set up email at your domain: Cloudflare → Email Routing (free) → forward `support@getwordwise.us` + `privacy@getwordwise.us` → your Gmail. ~5 min. (The existing policy pages list dead `@wordwise.app` addresses.)
- [ ] **[You]** Host `privacy`, `terms`, and a `delete-account` request page at a public URL — simplest is a **Cloudflare Pages** project on the existing domain (you're already on Cloudflare), or any static host. No backend needed.
- [ ] **[Claude]** Update the mobile Terms/Privacy screens + the static pages to the new `@getwordwise.us` addresses, and link them from the app.
- [ ] Result: `https://<host>/privacy`, `/terms`, `/delete-account` become the URLs you paste into both store forms.

---

## Phase 3 — Security hardening (before public traffic)

From the June security scan + what deployment exposed, ordered by risk.

- [ ] **[You]** Confirm Railway env: `DEBUG=False`, fresh `JWT_SECRET_KEY` (not the example value), `ALLOWED_ORIGINS` set (mobile native requests send no `Origin`, so this mainly guards any browser callers — set it to the static-pages host if those call the API).
- [ ] **[Claude]** Gate `/docs` + `/openapi.json` behind `DEBUG` — the full 133-route API surface is currently publicly enumerable.
- [ ] **[Claude]** Bump `requests==2.32.0` (yanked) → `2.32.3+` in both requirements files.
- [ ] **[Claude]** Proxy TMDB through the backend (`/api/tmdb/*` passthrough with caching). The rotated key still ships inside every app bundle — extractable by anyone. Backend proxy = key becomes truly server-side; also unlocks Cloudflare caching of poster/search responses.
- [ ] **[Claude]** Refresh-token revocation (jti denylist or per-user generation counter): today a stolen refresh token works for 60 days and logout can't kill it. Required before real users; fine to do week 1 post-launch if timeline is tight.
- [ ] Deferred (fine for single-instance MVP): in-memory rate limiter → Upstash Redis when you scale past one API instance.

---

## Phase 4 — Ops gaps (Cloudflare + Railway + Postgres)

None block submission; the first two protect you from disaster.

### 4.1 Database backups — **the only irreplaceable thing you have**
Your ~400 MB of enriched data is the product. Railway Postgres has backups on paid plans, but verify — don't assume.
- [ ] **[You]** Railway → Postgres service → Backups tab: confirm daily backups are ON and note retention.
- [ ] **[Claude]** Belt-and-suspenders: GitHub Actions weekly cron that `pg_dump`s prod (secret: `DATABASE_PUBLIC_URL`) and uploads to workflow artifacts / a private bucket. Restore drill documented in-repo.

### 4.2 Monitoring — right now, users find your outages before you do
- [ ] **[You]** Uptime: UptimeRobot / BetterStack free tier → monitor `https://api.getwordwise.us/health` every 1–5 min, alert on failure.
- [ ] **[Claude]** Error tracking: Sentry free tier — `sentry-sdk[fastapi]` in the backend, `@sentry/react-native` in mobile (catches crashes you'd otherwise never hear about). One DSN per platform, ~1h.
- [ ] **[You]** Railway usage alerts (Settings → Usage) so a runaway worker doesn't surprise the bill.

### 4.3 Edge caching — the reason Cloudflare is in the stack (global users)
- [ ] **[Claude]** Add `Cache-Control: public, max-age=…` to the static-ish GETs (`/movies/*`, vocabulary previews, CEFR data — same response for every user) and `private, no-store` on auth/user endpoints.
- [ ] **[You]** Cloudflare Cache Rule: cache `api.getwordwise.us/movies/*` respecting origin headers. Result: a user in Jakarta gets posters/vocab from a nearby PoP instead of a US round-trip — the single biggest latency win available.

### 4.4 Deploy pipeline polish
- [ ] **[Claude]** CI job that builds `docker/Dockerfile.backend` on amd64 (path-filtered to `backend/**`, `docker/**`) — catches image breakage in PR instead of on Railway (hit twice: libatomic, Railpack).
- [ ] **[Claude]** Persist worker seed cursor to DB (currently `.seed_cursor.json` on container FS — resets every deploy, re-walks TMDB discover; wasteful, not harmful).
- [ ] Later: staging environment (Railway PR environments) and `eas update` OTA channel discipline (prod hotfixes JS-only between store releases).

### 4.5 Worker scaling mode — **decided: burst → tiny always-on** (issue #78)

The worker service (`docker/start-workers.sh` = queue worker + AIMD rate
controller) auto-builds the TMDB catalog and is the memory-hungry process
(~2 GB, dominated by the spaCy/MiniLM/NLTK models each job loads for CEFR
classification — *not* the queue itself). It is **not in the user-serving
path**: the API reads finished movies straight from Postgres, and on-demand
work (enrichment/translation) runs in the API container via FastAPI
`background_tasks`. So the worker can be off with zero user impact — only
*catalog growth* pauses.

**Decision.** Build the catalog in **bursts**, then run a single **tiny
always-on** instance between them:

- **Steady state — worker up, `WORKER_SEED_ON_START=0`, queue empty.** This is
  now the code default (`backend/src/workers/worker.py`), so a restart or
  redeploy no longer re-seeds 500 films. With nothing to process the worker
  never imports the classifier (the ML imports are lazy), so it idles at a few
  hundred MB: just the claim loop plus the AIMD controller reaping stuck jobs
  and pruning `api_events`.
- **Burst — seed the queue; the worker self-sizes.** Set
  `WORKER_SEED_ON_START=<N>` for one boot (or run the seeder). As it processes
  it loads the models and climbs to ~2 GB until the queue drains.
- **After a burst — restart the worker.** Python holds the loaded models for
  the life of the process, so a post-burst worker sits at ~2 GB resident until
  it restarts. A redeploy sheds them and returns it to the cheap idle state.

> **Don't "size" this with Railway's memory slider.** Railway meters *actual*
> usage, not the ceiling, so lowering the limit saves nothing — and a 2 GB cap
> sits right on the worker's working set and would OOM-kill it mid-job. Leave
> the limit high; if you want a runaway guardrail, ~4 GB clears the working set
> while still killing a leak before it bills you for the plan maximum. The mode
> is controlled by the *queue contents*, not by a slider.

**Why not always-on 2 GB?** Pre-launch the queue is already drained (≈3,788
`done`) and nothing enqueues work while idle, so a 24/7 2 GB worker pays
continuously to grow a catalog we don't need to grow yet. **Why not
scale-to-zero?** The tiny always-on instance keeps reaping/retries working and
lets you enqueue a few titles ad-hoc without a full burst — for a couple of
dollars more than zero.

**Rate limiter & queue drain — respected in both modes.** The Postgres token
bucket (`rate_state`) gates every outbound API call and the controller tunes
`target_qps` via AIMD, so a burst can't outrun TMDB/OpenSubtitles regardless of
instance size; `FOR UPDATE SKIP LOCKED` keeps the drain correct across however
many worker processes a burst runs.

**Burst runbook.**
1. Railway → Worker service → Variables → `WORKER_SEED_ON_START=750` (≈ one
   `/discover` walk), deploy. Leave the memory limit alone.
2. Watch `GET /admin/stats` (queue counts) or the controller logs until
   `pending` → 0. Expect the worker to climb to ~2 GB while it works — normal.
3. **One-time — clear the 2026-07 dead-job backlog:** with the
   misclassification fixed (below), revive them so they reprocess —
   `python -m src.workers.requeue_dead --dry-run` to preview, then run it
   without `--dry-run`. ~200 already have a cached script and resolve instantly;
   the rest re-fetch. The command needs only `asyncpg` + `DATABASE_URL`, so it
   runs fine from a laptop — use Postgres → `DATABASE_PUBLIC_URL` (the internal
   URL only resolves inside Railway's network).
4. Done: `WORKER_SEED_ON_START` → 0 (or delete) and **redeploy** — that both
   stops the next boot re-seeding and sheds the ~2 GB of loaded models.

**No stuck/failing jobs.** The 571 jobs parked `dead` on 2026-07-10/11 were a
*misclassification*, not genuine misses: a transient "all sources failed"
outage was treated as permanent (201 of them already had a valid script row).
Fixed at the source — `ScriptIngestionService` now raises `ScriptNotFoundError`
**only** when every source cleanly reports no match; a source *erroring* is
transient and retried on backoff. The worker and `/api/scripts/fetch` both
classify by exception type now, not by scanning error strings. Clear the
existing backlog with `requeue_dead` during the next burst (step 3).

---

## Phase 5 — Store listing & submission (after Phases 1–2)

- [ ] **[You]** Assets: app icon (done — in repo), feature graphic 1024×500 (Play), screenshots per device class (6.7" + 5.5" iPhone; phone + 7"/10" tablet for Play — generate from the simulator), short + full descriptions.
- [ ] **[You]** Listing name: use **GetWordWise** or "WordWise — Movie Vocabulary" carefully — the bare "WordWise" name is owned by someone else; a trademark complaint post-launch can pull the listing. Brand as **GetWordWise**.
- [ ] **[You]** Production builds: `eas build --platform all --profile production` → `eas submit --platform ios` (TestFlight → App Review) and `eas submit --platform android` (closed testing track first — see Phase 1 gate).
- [ ] **[You]** Play: run the 14-day closed test → apply for production → staged rollout (20% → 100%).
- [ ] **[You]** Apple: expect 24–48h review; first submissions of login+content apps often get one rejection — the Phase 2 list is exactly the usual reasons, so clearing it first is the fast path.

---

## Suggested order of attack

1. **Today:** Phase 1 (Android preview build + SHA-1) — momentum, and it validates everything end-to-end.
2. **This week:** Phase 2.1–2.2 (account deletion, Apple sign-in — I can start both now), 2.5 (email + static privacy/terms/deletion pages), Phase 3 quick wins (`/docs` gate, `requests` bump, `ALLOWED_ORIGINS`), 4.1–4.2 (backups + uptime monitor — ~30 min total).
3. **Next:** Phase 2.3 decision (premium off vs. billing build-out), TMDB proxy, cache headers.
4. **Then:** Phase 5 submission, with the **Play closed-test clock already running** from step 1.

---

## Reference — mobile build & run-rate

### Expo EAS plans (2026)
| Plan | Price | Includes |
|---|---|---|
| **Free** ⭐ start here | $0 | 15 iOS + 15 Android builds/mo, OTA to 1,000 MAU, 100 GiB edge bandwidth |
| **Starter** | $19/mo | $45 priority-build credit — move here only when you want priority builds or hit limits |
| **Production** | $199/mo | $225 build credit, 50,000 MAU OTA, 1 TiB — a scale concern, not an MVP one |

The app uses native modules (`@react-native-google-signin/google-signin`) with committed `ios/` + `android/`, so **Expo Go won't run it** — EAS Build (or a local dev client) is required.

**Per-release flow:** `eas build --platform all --profile production` → `eas submit --platform all` → submit for review (Apple ~1–2 days; Google hours–days) → ship JS-only fixes between store releases with `eas update`, respecting `runtimeVersion`.

### Mandatory store fees (paid to Apple/Google, not Expo)
- **Apple Developer Program — $99/year** (TestFlight + App Store).
- **Google Play Developer — $25 one-time.**
- EAS **Submit** uploads builds to both; it does not charge the platform fees.

### Live stack & monthly run-rate
| Item | Cost |
|---|---|
| Railway (API ~1 GB + Worker: idles at a few hundred MB, ~2 GB only while a burst drains — §4.5 + managed Postgres, usage-based) | ~$25–50/mo |
| Cloudflare (free plan) | $0 |
| Expo EAS (Free tier) | $0 |
| Google Cloud Translation (≤ 500K chars/mo free, then ~$20/M) | $0 → usage |
| Anthropic example sentences | ≤ $50/mo (hard-capped via `LLM_COST_CAP_USD=50`) |
| **Recurring subtotal** | **≈ $30–60/mo** |
| Apple Developer | $99/year |
| Google Play | $25 one-time |

> **External-API usage is the variable to watch as you grow**, not hosting. Translations are cached (`TranslationCache`) and classification is precomputed by the worker, so per-user marginal cost stays low. Redis stays **skipped** for MVP — the job queue is Postgres-backed and `REDIS_URL` is optional.

---

*Previous pre-deploy plans (Railway/Render/Fly comparison, serverless rationale, DNS + data-migration steps) are archived in git history: `git log -- DEPLOYMENT.md DEPLOYMENT_ROADMAP.md`.*

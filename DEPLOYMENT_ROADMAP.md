# WordWise — Launch Roadmap v2 (post-backend-deploy)

> Rewritten 2026-07-07 after the backend went live. The old roadmap (Railway
> setup, DNS, data migration) is **done** — this file is what stands between
> the current state and a store launch that doesn't get rejected, hacked, or
> lost to an outage. Work the phases in order; items marked **[Claude]** are
> code changes I can make in-repo, **[You]** are dashboard/account actions
> only you can do.

---

## ✅ Where we are (verified live, 2026-07-07)

| Piece | Status |
|---|---|
| Backend API | Live at `https://api.getwordwise.us` (Railway + Cloudflare proxy, Full SSL, 133 routes, ~150ms) |
| PostgreSQL | Railway, Prisma migration baseline applied via pre-deploy command; **all local data imported & verified** (50k sentence bank, 89k lemma links, 5k classifications); sequences fixed |
| Worker | Deployed (`bash scripts/start-workers.sh`), seeding catalog (5 → 10+ movies), `schema.sql` applied |
| Domain | `getwordwise.us` on Cloudflare (free), `api.` CNAME proxied, TLS Full — **no redirect loops, verified** |
| Mobile config | `eas.json` + `runtimeVersion` + prod URL `api.getwordwise.us`; EAS CLI installed, logged in as `tamerleinn` |
| Store accounts | Apple Developer **active**; Google Play created (developer name: GetWordWise) |
| CI | Green (backend, frontend, mobile, schema jobs on every push) |

---

## Phase 1 — Finish the build pipeline (this week)

Goal: an installable build on a real phone, talking to prod.

- [ ] **[You]** Android preview build: `cd apps/mobile && eas build --platform android --profile preview`. Say **Yes** to "Generate a new Android Keystore". Install the APK on a phone and smoke-test movies/vocab against prod.
- [ ] **[You]** Register the release keystore's SHA-1 for Google Sign-In: `eas credentials` (Android → production → Keystore) → copy **SHA-1** → Google Cloud Console → the Android OAuth client for `com.wordwise.mobile` → add fingerprint. *Until this is done, Google login fails on EAS builds.*
- [ ] **[You]** iOS build (Apple account is active): `eas build --platform ios --profile preview`. EAS will walk you through signing (let it manage certificates). Test via TestFlight internal.
- [ ] **[You]** Recruit **~12 friends/testers now** for Google Play closed testing. New personal Play accounts must run a closed test (currently 12 testers for 14 consecutive days) **before Google grants production access**. This is the longest pole in the whole launch — start the clock ASAP. Apple has no equivalent gate.

---

## Phase 2 — Store-rejection blockers (fix BEFORE submitting)

Each of these is a known, common rejection reason. Verified against the codebase 2026-07-07 — none of them exist yet.

### 2.1 Account deletion — **Apple hard requirement** (Guideline 5.1.1(v))
Apps that let users create accounts **must** let them delete the account in-app. Google Play additionally requires a **web link** where users can request deletion (goes in the Data Safety form).
- [ ] **[Claude]** Backend: `DELETE /auth/me` endpoint — deletes the user row (cascades already exist on user-owned tables) after re-auth/confirmation.
- [ ] **[Claude]** Mobile: "Delete account" action in the profile sheet (UserMenuSheet), with confirm dialog.
- [ ] **[Claude]** Web: same action in settings, plus a small public "request deletion" page/URL for the Play form.

### 2.2 Sign in with Apple — **Apple requirement when Google Sign-In is present** (Guideline 4.8)
The app offers Google Sign-In, so Apple requires an equivalent privacy-focused option. Email/password does **not** satisfy 4.8.
- [ ] **[Claude]** Add `expo-apple-authentication` to mobile (iOS-only button), backend verification of Apple identity tokens (mirror of `google_auth.py`), `apple_id` column via Prisma migration.
- [ ] Estimate: ~half a day of work. Skipping it risks a 4.8 rejection on first review.

### 2.3 In-app purchases — decide now: ship v1 FREE or finish billing
The paywall/billing surface exists (`billing.py`: apple/google verify, restore, webhooks) but the June security scan flagged **receipt validation & webhook signatures as stubbed**, and consumables as fail-open. Shipping a live paywall that takes money without server-verified receipts = revenue loss + store trouble.
- [ ] **Decision**: launch v1 with premium **feature-flagged OFF** (fastest, recommended — the `feature_flags` table exists for exactly this), or
- [ ] implement real StoreKit2/Play Billing receipt validation + webhook signature verification (Apple `signedPayload` JWS, Google Pub/Sub) before launch. *If the paywall is visible in the binary, reviewers will test it.*

### 2.4 Review-pass essentials
- [ ] **[Claude]** `ITSAppUsesNonExemptEncryption: false` in `app.json` `ios.infoPlist` (app only uses HTTPS — this skips the export-compliance interrogation on every single build upload).
- [ ] **[You]** **Demo account** for reviewers: create a prod account (e.g. `review@getwordwise.us` / strong password), pre-populate with a movie + saved words, and put credentials in App Review notes on both stores. Login-gated apps without demo creds get rejected same-day.
- [ ] **[Claude]** **TMDB attribution**: TMDB's API terms require the notice "This product uses the TMDB API but is not endorsed or certified by TMDB" + logo. Add to the app's settings/about screen and web footer. Poster-heavy apps get flagged for this.
- [ ] **[You]** Copyright question prep: the app shows movie scripts/subtitles. Have a ready answer for review ("educational fair-use excerpts, vocabulary learning context") — and expect Apple may push back; worst case, script *excerpts* (sentence-length) are far safer than full scripts.
- [ ] **[You]** Data Safety form (Play) + Privacy Nutrition Labels (Apple): declare email, name, Google ID, usage data; no ads SDK currently; data deletable via 2.1.
- [ ] **[You]** Age rating questionnaires (both stores). Movie content → likely 12+/Teen; answer honestly, mismatches cause rejection.

### 2.5 Live privacy policy & terms URLs (store forms require public URLs)
The pages exist in the web app but the web app **isn't deployed** (GitHub Pages never enabled) and both pages list dead `@wordwise.app` emails.
- [ ] **[You]** Set up email at your domain: Cloudflare → Email Routing (free) → forward `support@getwordwise.us` + `privacy@getwordwise.us` → your Gmail. 5 minutes.
- [ ] **[Claude]** Update Terms/Privacy pages (web + mobile screens) to the new addresses.
- [ ] **[You]** Enable GitHub Pages (repo Settings → Pages → Source: GitHub Actions) + add `VITE_TMDB_API_KEY` secret so the deploy workflow goes green.
- [ ] Result: `https://<pages-url>/privacy` and `/terms` become the URLs you paste into both store forms.

---

## Phase 3 — Security hardening (before public traffic)

From the June security scan + what deployment exposed. Ordered by risk.

- [ ] **[You]** Confirm Railway env: `DEBUG=False`, fresh `JWT_SECRET_KEY` (not the example value), `ALLOWED_ORIGINS` set to the real web origin (until then, web browser calls will be CORS-blocked; mobile is unaffected).
- [ ] **[Claude]** Gate `/docs` + `/openapi.json` behind `DEBUG` — currently the full 133-route API surface is publicly enumerable (that's how I audited it).
- [ ] **[Claude]** Bump `requests==2.32.0` (yanked, CVE-mitigation conflict) → `2.32.3+` in both requirements files.
- [ ] **[Claude]** Proxy TMDB through the backend (`/api/tmdb/*` passthrough with caching). The rotated key still ships inside every app bundle — extractable by anyone. Backend proxy = key becomes truly server-side; also unlocks Cloudflare caching of poster/search responses.
- [ ] **[Claude]** Refresh-token revocation (jti denylist or per-user generation counter): today, a stolen refresh token works for 60 days and logout can't kill it. Required before real users; fine to do in week 1 post-launch if timeline is tight.
- [ ] Deferred (fine for single-instance MVP): in-memory rate limiter → Upstash Redis when you scale past one API instance; JWT-in-localStorage on web → httpOnly cookie refactor.

---

## Phase 4 — Ops gaps in the Cloudflare + Railway + Postgres architecture

What "seamless" is still missing. None block submission; the first two protect you from disaster.

### 4.1 Database backups — **the only irreplaceable thing you have**
Your 400MB of enriched data is the product. Railway Postgres has backups on paid plans but verify, don't assume.
- [ ] **[You]** Railway → Postgres service → Backups tab: confirm daily backups are ON and note retention.
- [ ] **[Claude]** Belt-and-suspenders: GitHub Actions weekly cron that `pg_dump`s prod (secret: `DATABASE_PUBLIC_URL`) and uploads to the workflow artifacts / a private bucket. Restore drill documented in this repo.

### 4.2 Monitoring — right now, users find your outages before you do
- [ ] **[You]** Uptime: UptimeRobot / BetterStack free tier → monitor `https://api.getwordwise.us/health` every 1–5 min, email/push alert on failure.
- [ ] **[Claude]** Error tracking: Sentry free tier — `sentry-sdk[fastapi]` in the backend, `@sentry/react-native` in mobile (catches crashes you'll otherwise never hear about), `@sentry/react` on web. One DSN per platform, ~1h total.
- [ ] **[You]** Railway usage alerts (Settings → Usage) so a runaway worker doesn't surprise the bill.

### 4.3 Edge caching — the reason Cloudflare is in the stack (global users!)
- [ ] **[Claude]** Add `Cache-Control: public, max-age=…` headers to the static-ish GETs (`/movies/*`, vocabulary previews, CEFR data — same response for every user) and `private, no-store` on auth/user endpoints.
- [ ] **[You]** Cloudflare Cache Rule: cache `api.getwordwise.us/movies/*` respecting origin headers. Result: a user in Jakarta gets posters/vocab from a nearby PoP instead of a US round-trip — the single biggest latency win available.

### 4.4 Deploy pipeline polish
- [ ] **[Claude]** CI job that builds `docker/Dockerfile.backend` on amd64 (path-filtered to `backend/**`, `docker/**`) — catches image breakage in PR instead of on Railway (we hit this twice: libatomic, Railpack).
- [ ] **[Claude]** Persist worker seed cursor to DB (currently `.seed_cursor.json` on container FS — resets every deploy, re-walks TMDB discover; wasteful, not harmful).
- [ ] Later: staging environment (Railway PR environments), and `eas update` OTA channel discipline (prod hotfixes JS-only between store releases).

---

## Phase 5 — Store listing & submission (after Phases 1–2)

- [ ] **[You]** Assets: app icon (done — in repo), feature graphic 1024×500 (Play), screenshots per device class (6.7" + 5.5" iPhone, phone + 7"/10" tablet for Play — can be generated from simulator), short + full descriptions.
- [ ] **[You]** Listing name: use **GetWordWise** or "WordWise — Movie Vocabulary" carefully — the bare "WordWise" name is owned by someone else; a trademark complaint post-launch can take the listing down. Safer to brand as GetWordWise.
- [ ] **[You]** Production builds: `eas build --platform all --profile production` → `eas submit --platform ios` (TestFlight → App Review) and `eas submit --platform android` (closed testing track first — see Phase 1 gate).
- [ ] **[You]** Play: run the 14-day closed test → apply for production → staged rollout (20% → 100%).
- [ ] **[You]** Apple: expect 24–48h review; first submissions of login+content apps often get one rejection — the Phase 2 list is exactly the usual reasons, so clearing it first is the fast path.

---

## Suggested order of attack

1. **Today**: Phase 1 (Android preview build + SHA-1) — momentum + validates everything.
2. **This week**: Phase 2.1–2.2 (account deletion, Apple sign-in — I can start both now), 2.5 (email + Pages), Phase 3 quick wins (`/docs` gate, requests bump, ALLOWED_ORIGINS), 4.1–4.2 (backups + uptime monitor — 30 min total).
3. **Next**: Phase 2.3 decision (premium off vs. billing build-out), TMDB proxy, cache headers.
4. **Then**: Phase 5 submission, with the Play closed-test clock already running from step 1.

*Previous roadmap (Railway/DNS/data-migration steps) is archived in git history (`git log -- DEPLOYMENT_ROADMAP.md`).*

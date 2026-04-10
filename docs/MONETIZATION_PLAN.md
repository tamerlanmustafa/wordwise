# WordWise Monetization Plan — v0.2

> **Status:** Second iteration. Replaces v0.1 after a critical re-evaluation. The previous draft leaned on artificial restrictions inside the core read → save loop (50-word cap, save cap, daily ingestion cap). This version removes them and reanchors the premium pitch around a single value proposition — long-term memory — instead of a list of removed restrictions. Numbers (prices, limits, CPMs) are still rough placeholders.

## 0. What WordWise is

**WordWise is a vocabulary-learning app that turns English-language movies into personalized CEFR-ranked word lists.** The pitch: "learn English from the films you'd watch anyway." We are **not** a streaming service — users don't watch movies inside WordWise. We analyze each film's script/subtitles and surface the vocabulary that's actually worth learning for a given learner's level.

### How it works, end-to-end

1. **Catalog ingestion (automated worker).** A background worker pulls popular English films from TMDB (`/discover/movie` sorted by vote count, English originals with ≥1000 votes), fetches each film's script or subtitles from third-party sources (STANDS4, OpenSubtitles, etc.), and queues them for processing. The catalog currently holds ~1,100+ processed films and grows by 500 per worker start.
2. **CEFR classification.** For every movie script, a hybrid classifier tokenizes/lemmatizes the text, looks each lemma up against Cambridge/Oxford CEFR word lists, falls back to frequency-based heuristics (`wordfreq`) for unknowns, and tags each word with a CEFR level (A1 → C2). A genre-normalized difficulty score (0–100) is also computed per movie using 10 weighted signals (complex word ratio, Zipf rarity, readability, etc.).
3. **Translation.** Definitions come from local dictionaries; example-sentence translations go through DeepL (paid API, per-character billing) into the user's chosen target language.
4. **Learner-facing apps.** A React Native mobile app (Expo) and a React web app both talk to a FastAPI + Prisma + PostgreSQL backend. Users browse the catalog, open a movie, and see its vocabulary sorted and color-coded by CEFR. Tapping a word shows the definition, a translation, and the original subtitle line it appeared in.
5. **Personalization.** The app tracks which words a user has already seen (across movies) and filters them out of new movies' lists, so a learner is always looking at "new-to-me" vocab. Longer-term plans include spaced-repetition review, learner-level estimation, and cross-device sync.

### Tech stack (for context)

- **Mobile:** React Native + Expo, hand-rolled navigation, Zustand for auth state, AsyncStorage for persistence.
- **Web:** React + Vite.
- **Backend:** FastAPI, Prisma (Python), PostgreSQL, adaptive worker pool with AIMD rate control.
- **External APIs:** TMDB (metadata, posters, popularity), DeepL (translation), STANDS4/OpenSubtitles (scripts).
- **Auth:** Email/password + Google Sign-In (OAuth).

### Who it's for

English learners — students, self-studiers, and people who already watch English-language films and want a structured way to pick up vocabulary while they do it. Core demographic skews young (teens through mid-20s), global, with heavy initial interest expected from non-English-first countries (Turkey, Brazil, India, Spanish-speaking LATAM, etc.). "I watch Marvel movies — teach me English from them" is the canonical user story.

### What this document is

The plan below is the **second iteration** of how we turn the above into a sustainable business. It covers: which parts become premium vs. free-with-ads, where the paywalls should live, how ads should be integrated without ruining the learning experience, and how admins can comp individual users without going through the App Store. None of it is committed — this doc exists so the team (and any reviewer we hand it to) can argue about the right split before we write the first line of billing code.

---

## 1. Strategy in one paragraph

**WordWise is free to learn from. WordWise Plus is paid to remember from.** The free product is a complete vocab discovery tool — every movie, every word, every save, every basic translation. Premium is a single coherent product layered on top: a memory system that turns the words you saved into long-term retention, with supporting features (cross-movie context, multi-language, audio, offline) that exist to make that memory system better. The model is **value-additive, not restriction-based.** Free users never hit a wall in the middle of the core loop; they hit upgrade prompts only after they've already received value and are explicitly asking for the premium feature.

## 2. Guiding principles

1. **The free product must be complete, not crippled.** A free user has to be able to complete one full *learning session* end-to-end — open a movie, scroll its word list, tap any word, get a definition and translation, save what they want to remember — without hitting a paywall. We're a vocab-learning app, not a streaming app; nobody watches the film inside WordWise. That first session is the "aha" moment. Lose it and the user uninstalls before they ever see an upsell.
2. **Paywalls fire after value delivery, never during it.** Every upgrade prompt should be triggered by a user action that signals "I want the premium feature" — opening a review session, asking for cross-movie context, switching languages. Paywalls that interrupt mid-flow get the app uninstalled.
3. **Honest gating: charge where we pay.** Features that cost us real marginal money (DeepL, TTS, premium catalog growth) are honest premium candidates. Features that cost us nothing should not be gated for the sake of inventing scarcity.
4. **Premium is a product, not a list.** Everything in Plus must support a single sentence: "stop forgetting the words you saved." If a feature can't be slotted under that umbrella, it's a distraction from the pitch.
5. **Admins and comped accounts get full access.** No exceptions, no monthly headaches. (See §6.)

## 3. The tiers

### 🟢 Free

A complete vocabulary-discovery experience. No gates inside the read → understand → save loop.

- **Browse, search, and fetch any movie** — including titles not yet in our catalog. No daily cap. A 5/hour per-user rate limit exists purely as anti-abuse, set high enough that no honest learner ever notices.
- **Full word list for every movie.** Every word, every CEFR level, sorted however the user wants. No 50-word cap, no blurred rows, no "upgrade to see more." The list is the product; gating it is gating the product.
- **Tap any word → definition + 1 translation** into the user's chosen native language.
- **The original in-movie example sentence** for every word. We already have it in the script, no DeepL cost — no reason to gate it.
- **Unlimited saves.** Saving is how learning starts, and it's the bridge to SRS. Capping it kneecaps the very feature we want users to upgrade for.
- **Basic saved-words view.** Reverse-chronological notebook of every word the user has saved, grouped by movie. Re-tap any word to see its definition again. This is *not* SRS — there's no scheduling, no recall testing, no forgetting curve. It's a notebook.
- **Cross-device sync of saved words.** Free users shouldn't lose their notebook when they change phones. Table stakes in 2026.
- **Already-seen-word filtering.** The personalization that hides words the user has already encountered in other movies — core to the product, free for everyone.
- **Ads.** Light and outside the reading surface. Two surfaces only:
  1. One interstitial when *opening* a movie (with an optional rewarded-video that grants ingestion priority for the next fetch).
  2. A small banner on the home screen.
  Never inside word lists, never on word taps, never during save actions, never during reviews.

### 🟣 Premium — "WordWise Plus"

**One-sentence pitch:** *Stop forgetting the words you saved.*

Plus is a memory system, not a feature list. Everything below exists to support that promise.

**The headline:**
- **Spaced-repetition review.** Every saved word enters a Leitner/SM-2 schedule. The app surfaces words at the moment you're about to forget them. ~5–10 minute daily session, calibrated to your actual deck. *This is the product.*
- **Memory analytics.** "You know 312 words. 47 are due for review. Your retention rate is 84%." Visible, motivating, daily progress. Free users see a saved-word count; premium users see whether those words are actually sticking. Cheap to build, enormously retention-positive.

**Features that make the memory system better:**
- **Cross-movie example sentences (DeepL-powered).** When a saved word comes up for review, the card shows it in 2–3 other movies' contexts. Varied-context exposure is one of the strongest known ways to cement vocabulary. Premium specifically because every uncached (sentence, target_language) pair has a real DeepL cost — honest cost-pass-through, not artificial scarcity. We cache aggressively in `sentence_bank`, so cost per lookup trends toward zero over time.
- **Audio pronunciation on review cards.** TTS API has real per-character billing — gating is honest.
- **Multiple target languages simultaneously.** Review the same word in two or three languages side by side. Real differentiator for learners studying more than one language at once (e.g., a Turkish speaker picking up both English and Spanish).
- **Offline mode.** Download a movie's word list, audio, and your review queue for study on planes/subways. Real engineering work; real value.
- **Priority ingestion lane.** New-movie fetch jobs from premium users get `priority=0`; free jobs get `priority=5`. Premium never waits behind a free backlog. Frame as "your movies first," not "free users get punished." One-line change to the existing `movie_jobs` schema.
- **Export to Anki / CSV.** Power-user retention feature.
- **Ad-free.** Stated last on purpose. It's a benefit, not the pitch.

**What's deliberately *not* in premium:** anything the free product would feel broken without — full word lists, unlimited saves, catalog access, basic saved-words view, already-seen filtering, sync.

### 🟡 Deliberately *not* gated either way

- **Reporting a bad word/translation.** Never charge for fixing our data — we want the signal.
- **Sign-in, profile, basic settings.** Obvious, but worth naming.
- **The first movie a new user opens after install.** Ad-free, paywall-free, priority queue, regardless of tier. This is the install-to-engaged conversion shot.

## 4. Where the paywalls actually live

The single rule: **paywalls fire only after the user has already received value, never during it.** Every trigger below is gated on a user action that *requests* the premium feature.

| Trigger | When it fires | Why it's a healthy moment |
|---|---|---|
| **"Review your words" CTA** | Day 2+, the home screen shows "You saved 14 words yesterday — review them?" Tap → SRS paywall. | The user came back voluntarily, they have a deck, and they're explicitly asking to do the thing premium does. **This is the highest-intent moment in the entire app and the primary upsell.** |
| **"How well do you remember these?"** | After saving the 10th word in a single session, an inline card asks "Want to test yourself on these later?" Dismissable, non-blocking. | High engagement, in-context, doesn't interrupt. |
| **Cross-movie context tap** | User taps a word and sees "this word also appears in 4 other movies →" with one preview row. Tap "see all" → upsell. | They asked for it. They already see one teaser. Pure curiosity-driven, no prior friction. |
| **Multi-language switcher** | User in settings tries to add a second simultaneous target language. | Niche, high-intent, zero impact on free experience. |
| **Lane wait banner** | A free user enqueues a new movie and there's an actual non-empty queue. Soft banner: "Skip the wait — Plus." Never blocks ingestion. | Self-justifying — only shown when the wait is real. |
| **Remove ads** | Tap the small "×" on any ad. | Lowest-friction upsell. Always present, never primary. |

**Triggers explicitly removed from v0.1:**
- Mid-word-list cutoff at 50 words (gone — full lists are free).
- Save-cap exhaustion (gone — saves are unlimited).
- Daily ingestion exhaustion (gone — uncapped except for the abuse rate limit).

## 5. Ads (free tier only)

- **Format:** rewarded video preferred over interstitials wherever it fits. Higher eCPM, better user perception, gives the user something in return.
- **Placement:** movie-open interstitial + home-screen banner. **Nothing inside word lists, word taps, save actions, or review flows.** Ads inside the reading surface would interrupt the core action and damage the very thing free is supposed to demonstrate.
- **Network:** AdMob first (mature SDK, decent fill globally, easy to integrate via Expo); add Meta Audience Network later if eCPM justifies the SDK weight.
- **Frequency cap:** at most 1 interstitial per 5 minutes, never two in a row, never on the *first* movie of any session.
- **Underage / regulated regions:** non-personalized ads only; opt-in flows for COPPA/GDPR-K applicable users. `ads_eligible` flag on `User`.
- **"Remove ads" upsell** is a single tap on any ad's close button.

## 6. Admins + comped accounts (full access, no payment)

Admins and hand-picked users need a way to bypass every paywall, ad, and quota without going through the App Store — for testing, support, teacher partnerships, giveaways, and contributors.

- **All admin users are implicitly premium.** Anyone with `isAdmin=true` on `User` inherits every premium entitlement automatically. No separate `subscription_tier` flip, no risk of an admin losing access mid-session. The entitlement check is `user.is_admin OR tier in ('premium', 'comped') OR (tier == 'trial' AND not expired)`.
- **Admins also see no ads.** An admin debugging a report shouldn't have an interstitial appear mid-investigation.
- **Comped "lifetime" grants for non-admins.** New tier value `comped` alongside `free` / `trial` / `premium`. Comped users have full premium entitlements with no expiry and no billing. Use cases:
  - Early beta testers and friends-and-family
  - Teachers running classroom pilots
  - Content contributors (good word reports, blog posts, etc.)
  - Customer support goodwill ("sorry for the bug, here's a year of Plus")
  - Internal QA accounts
- **Admin UI to grant/revoke.** In the existing admin panel:
  - User search (email / username)
  - "Grant WordWise Plus" button with an optional expiry date (default: no expiry)
  - "Revoke" button that flips them back to `free`
  - Audit log of every grant/revoke with `granted_by`, `granted_at`, `reason`, `expires_at`
- **Backend sketch:**
  - New columns on `User`: `subscription_tier` (enum: `free|trial|premium|comped`), `subscription_expires_at`, `comped_reason`, `comped_granted_by`.
  - New table `subscription_audit_log` with `action` (`grant|revoke|auto_expire`).
  - A single `is_premium(user)` helper. Every entitlement check goes through it — never hand-roll the logic at call sites.
  - Mobile and web read an `entitlements` blob from `/auth/me` (`{ is_premium, features: [...], ingestion_priority }`) rather than inferring entitlements from `subscription_tier`. Keeps the client dumb and makes future tier splits painless.
- **Don't abuse comps.** A simple dashboard tracking `paying / comped / admin / free` counts keeps us honest. If comped ever significantly outnumbers paying, we've lost the plot.

## 7. Pricing starting point (North American benchmarks)

- **Monthly:** ~$4.99 USD
- **Annual:** ~$29.99 USD (≈50% off — standard "2 months free" framing)
- **Lifetime (early-adopter only):** $79 USD — launch-buzz play, retire after the first cohort.
- **Student discount:** 50% off via SheerID or .edu email verification. Our target audience is literally students.
- **Regional pricing:** match Apple/Google's automatic regional tiers (the App Store handles this). Critical for Turkey/India/LATAM where $4.99 is not the same as in the US.
- **Family plan (4 seats):** defer to v2 — don't build until we have paying singles.
- **Free trial:** 7-day free trial of Plus, triggered by the SRS paywall (so the user experiences the actual headline feature before being charged).

## 8. Phased rollout

The point of phasing is to ship instrumentation first, then gate based on what we actually measure rather than what we guessed.

### Phase 1 — Instrument & build the entitlement substrate (no user-visible monetization)
- [ ] Add `subscription_tier`, `subscription_expires_at`, `comped_reason`, `comped_granted_by` columns to `User`. Default everyone to `free`.
- [ ] Create `subscription_audit_log` table.
- [ ] Implement the central `is_premium(user)` helper. Every entitlement check in the codebase routes through it. Admins (`is_admin=true`) unconditionally return true.
- [ ] Build the admin grant/revoke UI **before** any real paywall, so we can comp ourselves for testing and seed beta accounts on day one.
- [ ] Add `ads_eligible` (bool, default true; false for under-13 / regions requiring opt-in).
- [ ] Log every interaction that *would* be a paywall hit later (review-CTA tap, save-the-10th-word event, cross-movie-context tap, lane-wait event) behind a feature flag. We need baseline engagement data before we gate anything.
- [ ] Build the basic free saved-words notebook view. Without it there's nothing to convert from.

### Phase 2 — Build SRS (the headline feature), then ship Plus
- [ ] SRS scheduler (Leitner or SM-2; start with Leitner, simpler).
- [ ] Review session UI (single screen, rich card with definition + translation + in-movie sentence).
- [ ] Memory analytics dashboard (retention rate, words due, words known).
- [ ] Cross-movie example sentences (read from `sentence_bank`, fetch from DeepL on cache miss).
- [ ] Light ad integration on free (movie-open interstitial + home banner) using AdMob.
- [ ] StoreKit / Google Play Billing integration. Subscription products: monthly + annual. Hold off on lifetime until launch.
- [ ] Wire the SRS paywall + the cross-movie context paywall + the multi-language paywall. Nothing else gates yet.

### Phase 3 — Read the data, tighten or loosen
- [ ] Look at conversion rate by paywall trigger. If the "review your words" CTA is converting >3% of free users who see it, double down. If <0.5%, re-examine the deck-building experience upstream — most likely free users aren't saving enough words for the pitch to land.
- [ ] Look at the lane-wait event log. If queue waits are effectively zero, retire the "skip the queue" upsell. If they're meaningful, surface it more prominently.
- [ ] Decide on Plus extras: offline, audio, export, family. Build them in priority order based on which premium users actually request.
- [ ] Tune the abuse rate limit on free ingestion based on real traffic shape.

## 9. Open questions for the next iteration

1. **Free-tier pronunciation.** We currently show no audio at all. Should free get *one* TTS pronunciation per word (cached forever, near-zero marginal cost after first hit) and premium get the richer audio features (slow playback, multiple accents, sentence-level)? Probably yes. Worth deciding before Phase 2.
2. **Trial length.** 7 days is the conservative starting point but might be too short for a memory product where the value compounds over weeks. Test 7 vs 14 once we have any volume.
3. **Gifting.** Adjacent to comping but external — letting one user pay for another user's Plus. Defer to v2 unless something pulls it forward.
4. **Web monetization parity.** This plan is mobile-first because that's where the engagement is, but the web app exists and needs at least basic Stripe-driven Plus. Can probably reuse the same `entitlements` API and just bolt Stripe onto the backend.
5. **Anti-abuse on comps.** What's the threshold where we should pause new grants? Probably "comped > paying" but we should commit to a number before shipping the grant UI.

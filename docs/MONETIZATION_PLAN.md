# WordWise Monetization Plan — v0.4

> **Status:** Fourth iteration. Incorporates two rounds of external review. v0.3 narrowed launch to SRS + ad-free and added a daily habit loop, but reviewers flagged: (1) word-of-the-day risks cannibalizing the SRS pitch if it feels like review, (2) one free SRS session may not be enough to sell a memory product, (3) the plan is one big bet on SRS with insufficient pivot flexibility, (4) banner-only ads may not generate enough revenue. This version tightens the free/premium boundary, makes the SRS preview testable, and adds explicit fallback paths.

## 0. What WordWise is

**WordWise is a vocabulary-learning app that turns English-language movies into personalized CEFR-ranked word lists.** The pitch: "learn English from the films you'd watch anyway." We are **not** a streaming service — users don't watch movies inside WordWise. We analyze each film's script/subtitles and surface the vocabulary that's actually worth learning for a given learner's level.

### How it works, end-to-end

1. **Catalog ingestion (automated worker).** A background worker pulls popular English films from TMDB (`/discover/movie` sorted by vote count, English originals with ≥1000 votes), fetches each film's script or subtitles from third-party sources (STANDS4, OpenSubtitles, etc.), and queues them for processing. The catalog currently holds ~1,100+ processed films and grows by 500 per worker run.
2. **CEFR classification.** For every movie script, a hybrid classifier tokenizes/lemmatizes the text, looks each lemma up against Cambridge/Oxford CEFR word lists, falls back to frequency-based heuristics (`wordfreq`) for unknowns, and tags each word with a CEFR level (A1 → C2). A genre-normalized difficulty score (0–100) is also computed per movie using 10 weighted signals (complex word ratio, Zipf rarity, readability, etc.).
3. **Translation.** Definitions come from local dictionaries; example-sentence translations go through DeepL (paid API, per-character billing) into the user's chosen target language.
4. **Learner-facing apps.** A React Native mobile app (Expo) and a React web app both talk to a FastAPI + Prisma + PostgreSQL backend. Users browse the catalog, open a movie, and see its vocabulary sorted and color-coded by CEFR. Tapping a word shows the definition, a translation, and the original subtitle line it appeared in.
5. **Personalization.** The app tracks which words a user has already seen (across movies) and filters them out of new movies' lists, so a learner is always looking at "new-to-me" vocab.

### Tech stack (for context)

- **Mobile:** React Native + Expo, hand-rolled navigation, Zustand for auth state, AsyncStorage for persistence.
- **Web:** React + Vite.
- **Backend:** FastAPI, Prisma (Python), PostgreSQL, adaptive worker pool with AIMD rate control.
- **External APIs:** TMDB (metadata, posters, popularity), DeepL (translation), STANDS4/OpenSubtitles (scripts).
- **Auth:** Email/password + Google Sign-In (OAuth).

### Who it's for

English learners — students, self-studiers, and people who already watch English-language films and want a structured way to pick up vocabulary while they do it. Core demographic skews young (teens through mid-20s), global, with heavy initial interest expected from non-English-first countries (Turkey, Brazil, India, Spanish-speaking LATAM, etc.). "I watch Marvel movies — teach me English from them" is the canonical user story.

### What this document is

This plan covers how we turn the above into a sustainable business. It is deliberately narrow in launch scope — the lesson from earlier iterations was that breadth of premium features doesn't matter until we've proven which *one* feature actually drives payment. This version also includes explicit fallback paths in case the core SRS bet underperforms. Everything here is a starting point for discussion, not a committed design.

---

## 1. Strategy in one paragraph

**WordWise is free to learn from. WordWise Plus is paid to remember from.** The free product is a complete vocab discovery tool — every movie, every word, every save, every basic translation, plus a lightweight daily habit mechanism ("word of the day" from your saved deck). Premium is a single product layered on top: **spaced-repetition review + ad removal.** That's it for launch. Everything else (cross-movie context, offline, multi-language, audio, export) is Phase 3 backlog — built only after we have data showing that SRS converts.

## 2. Guiding principles

1. **The free product must be complete, not crippled.** A free user completes one full learning session — open a movie, scroll its word list, tap words, get definitions and translations, save what they want — without hitting a paywall. That session is the "aha" moment.
2. **Paywalls fire after value delivery, never during it.** Upgrade prompts are triggered by user actions that *request* the premium feature, not by walls that interrupt the free flow.
3. **Honest gating: charge where we pay.** Features with real marginal cost (DeepL, TTS) are honest premium candidates. Features that cost us nothing should not be gated to invent scarcity.
4. **Prove before building.** Don't build premium features on assumptions. Ship the minimum premium product (SRS + ad-free), measure, then expand or pivot based on what users actually do.
5. **Admins and comped accounts get full access.** (See §6.)

## 3. The tiers

### 🟢 Free (ad-supported)

A complete vocabulary-discovery experience. No gates inside the read → understand → save loop. Plus a lightweight daily habit to give free users a reason to come back.

**Core loop (ungated):**
- **Browse, search, and fetch any movie** — including titles not yet in our catalog. No daily cap. A per-user rate limit (5/hour) exists purely as anti-abuse.
- **Full word list for every movie.** Every word, every CEFR level, no caps, no blurred rows.
- **Tap any word → definition + 1 translation** into the user's native language.
- **The original in-movie example sentence** for every word (no DeepL cost — we already have it).
- **Unlimited saves.** Saving is the bridge to SRS. Capping it would prevent users from building the deck that makes premium valuable.
- **Basic saved-words notebook.** Reverse-chronological list of saved words, grouped by movie. Re-tap to see definitions. This is a notebook, not a review system — no scheduling, no recall testing, no forgetting curve.
- **Already-seen-word filtering.** Hides words the user has encountered in previous movies. Core personalization, free for everyone.

**Daily habit (free) — "Today's Word":**
- Each day the home screen highlights **one word from a popular movie at the user's CEFR level** — shows the word, its movie, the definition, and the in-movie sentence. This is a *discovery* nudge, not a review mechanic.
- **Critically: this is NOT drawn from the user's saved deck.** If we pull from saved words, we create a mini-SRS that satisfies the recall need and undercuts the premium pitch. The daily word is always a *new* word the user hasn't saved yet — it's "here's something new to learn today," not "do you remember this?" The intent is:
  1. Give free users a reason to open the app daily (retention).
  2. Drive discovery of new movies and new vocabulary (engagement).
  3. Prompt saving → growing the deck → making SRS more valuable when the user eventually tries it.
- If the user taps "Save this word," it goes into their notebook like any other save. That save grows their deck, which increases the value proposition of SRS review.
- The upgrade nudge below the card is: "You have N saved words. Want to make sure you remember them? → Plus." This frames SRS as the *answer* to the growing deck, not as a fancier version of the daily card.

**Ads:**
- A small **banner on the home screen** only. Not on word lists, not on word taps, not on movie detail, not on saves.
- **No interstitials at launch.** The v0.2 plan placed an interstitial on movie-open, but that's the *start* of the learning loop, not outside it. An ad before the user sees the word list poisons the first impression. Revisit in Phase 3 only if banner eCPM is too low to sustain the free tier.
- **No ads on the first session ever.** New users see zero ads until their second app open.

### 🟣 Premium — "WordWise Plus" (launch version)

**One-sentence pitch:** *Stop forgetting the words you saved.*

**Launch scope (two features only):**

1. **Spaced-repetition review.** Every saved word enters a Leitner schedule. The app surfaces words at the moment you're about to forget them. ~5–10 minute daily session, calibrated to your actual deck. Review cards show: word, definition, translation, in-movie sentence, CEFR level. After each card: "Got it" / "Forgot" buttons that adjust the schedule.

2. **Ad-free.** Remove the home-screen banner. Simple, tangible, immediate.

That's it. No cross-movie context, no audio, no offline, no multi-language, no export, no analytics dashboard. Not because those are bad ideas — because **we don't know yet if SRS is the thing users will pay for.** If it is, we layer on the supporting features in Phase 3. If it isn't, we've saved months of engineering on the wrong bet.

**Free SRS preview (A/B testable).** The first time a user taps the "Review your words" CTA, they get a free taste of SRS before hitting the paywall. **The exact dose is a launch-day A/B test, not a fixed decision:**

| Variant | What the user gets | Hypothesis |
|---|---|---|
| A (conservative) | 1 session, up to 10 cards | Enough to feel the mechanic; fast path to paywall. |
| B (moderate) | 3 sessions across 3 days | Lets the user experience "the app reminded me and I remembered" — the core SRS value loop — before paying. |
| C (generous) | 7 days unlimited | Full trial-before-trial. Risk: some users get enough free SRS to never convert. |

After the free preview ends, the paywall appears: "You reviewed N words and remembered X%. Keep your streak going? → Start 7-day free trial."

**Why A/B test instead of picking one:** Reviewers flagged that for a memory product, one session may not be enough — the value compounds over days, not minutes. But giving too much away risks satisfying the need for free. We don't know the right dose yet, so we ship all three behind a feature flag and let conversion data decide within the first 2 weeks.

### 🟡 Deliberately not gated

- **Reporting a bad word/translation.** Never charge for fixing our data.
- **Sign-in, profile, settings.** Obvious.
- **The first movie a new user opens.** Ad-free regardless of tier. The install-to-engaged conversion shot.

### 🔮 Premium backlog (Phase 3+, build only with data)

These are real features that *might* become premium, but only after we've proven the core SRS pitch converts. Ordered by likely impact:

1. **Memory analytics dashboard** — retention rate, words due, words known. Natural complement to SRS; ship first if SRS converts.
2. **Cross-movie example sentences** — DeepL-powered, real marginal cost. Ship second.
3. **Audio pronunciation** — TTS cost. Ship third.
4. **Multiple target languages** — niche but high-intent.
5. **Offline mode** — real engineering cost, real value.
6. **Export to Anki / CSV** — power-user retention.

Priority ingestion (free=5, premium=0) remains an **internal QoS policy**, not a marketed premium benefit. Users won't pay for something invisible, and promoting it feels like a backend trick. Keep it as a silent perk.

## 4. Where the paywalls actually live

**Only two paywall triggers at launch.** Keep it simple. Add more in Phase 3 if conversion data justifies it.

| Trigger | When it fires | Why it works |
|---|---|---|
| **"Review your words" CTA** | Day 2+. The home screen shows "You saved N words — review them?" Tap → free SRS preview (A/B tested: 1 session, 3 sessions, or 7 days). After the free preview ends → paywall with 7-day trial offer. | Highest-intent moment in the app. User came back, has a deck, experienced the product, and is now choosing whether to continue. This is the primary conversion event. |
| **"Today's Word" upgrade nudge** | Below the daily discovery word card, a soft text line: "You have N saved words. Make sure you remember them → Plus." Not a modal, not a blocker. | Daily touchpoint. Low friction, high frequency. The user just saved a new word or saw a new word — the nudge frames SRS as the answer to their growing deck, not a fancier daily card. |

**Triggers removed or deferred from v0.2:**
- "Save 10th word" inline card — too weak, fires during active engagement when the user is focused on the movie, easy to dismiss and forget.
- Cross-movie context tap — deferred because the feature itself is deferred.
- Multi-language switcher — deferred.
- Lane wait banner — deferred; priority ingestion is internal QoS, not a marketed benefit.
- Remove-ads CTA — **kept implicitly** (tapping the banner's close button still opens the Plus page), but not listed as a primary trigger because ad-free alone rarely converts at $4.99/mo.

## 5. Ads (free tier only)

- **Launch format: home-screen banner only.** No interstitials. The v0.2 plan placed an interstitial on movie-open, but reviewers correctly flagged that it sits inside the learning loop. An ad *before* the word list damages the first impression of the core product. If banner-only eCPM can't sustain the free tier, revisit interstitials in Phase 3 with careful A/B testing.
- **Network:** AdMob (mature SDK, decent global fill, easy Expo integration).
- **No ads on first session.** New users see zero ads until their second app open.
- **No ads inside word lists, word taps, saves, or review.** Non-negotiable.
- **Underage / regulated regions:** non-personalized ads only. `ads_eligible` flag on `User`.

## 6. Admins + comped accounts

Admins and hand-picked users get full premium access without payment.

- **Admins (`is_admin=true`) are implicitly premium.** The entitlement check is `user.is_admin OR tier in ('premium', 'comped') OR (tier == 'trial' AND not expired)`. One helper function, every check goes through it.
- **Admins see no ads.**
- **Comped grants for non-admins.** Tier value `comped` — full premium, no expiry, no billing. For: beta testers, teachers, contributors, support goodwill, QA.
- **Admin UI: lightweight.** User search (email/username) + "Grant Plus" button with optional expiry + "Revoke" button. **No audit log table at launch** — overkill for current scale. Log grants/revokes to application logs; build a proper audit table when comped accounts exceed ~50.
- **Backend:** New columns on `User`: `subscription_tier` (enum: `free|trial|premium|comped`), `subscription_expires_at` (nullable). A single `is_premium(user)` helper. Mobile reads an `entitlements` object from `/auth/me`.

**Admin tier preview toggle (QA requirement).** Admins need to see the app exactly as a free user does without losing their own access — otherwise we can't test paywalls, ads, and upgrade nudges in the actual product.

- **UI:** A segmented toggle in the admin settings screen (mobile + web): `Admin view` / `Premium view` / `Free view`. Default: `Admin view` (current behavior — full access, no ads). Persists per-device in AsyncStorage/localStorage so a refresh doesn't reset it.
- **Scope:** Client-side entitlement override only. The toggle wraps the `is_premium()` / `is_ad_eligible()` helpers with a local override when the user is an admin. It does **not** downgrade the user's actual `subscription_tier` column, does **not** change any server-side data, and does **not** affect other users. Server endpoints still authorize the admin normally — this is a view layer simulation, not an impersonation.
- **What it affects:** ad rendering (banner shows/hides), paywall triggers (review CTA, Today's Word nudge), free SRS preview gating, any `is_premium` conditional in the UI. An always-visible badge in the header ("Viewing as: Free") keeps the admin aware they're in preview mode so they don't mistake a simulated state for a bug.
- **What it does NOT affect:** the admin grant/revoke UI, admin-only routes, backend data mutations. Admins keep their operational powers regardless of the toggle.
- **Why client-side only:** simpler, reversible, no risk of an admin accidentally locking themselves out or corrupting billing state. One reload clears it if anything goes wrong.

## 7. Pricing

- **Monthly:** $4.99 USD
- **Annual:** $29.99 USD (~50% off, "2 months free" framing)
- **No lifetime plan at launch.** Reviewers correctly flagged this as premature — it anchors pricing before we know real LTV and cannibalizes annual subscribers. Revisit only if annual churn data shows users want a one-time option.
- **Student discount:** 50% off via .edu email or SheerID. Our audience is literally students.
- **Regional pricing:** Apple/Google automatic regional tiers. Critical for Turkey/India/LATAM.
- **Free trial:** 7-day, triggered after the one free SRS session. User experiences the product before the trial clock starts.
- **Family plan:** defer to v2.

## 8. Daily habit loop

v0.2 had no mechanism to bring free users back daily. v0.3 added "word of the day from your saved deck," but reviewers flagged that pulling from saved words creates a mini-SRS that blurs the free/premium boundary. v0.4 fixes this by making the daily card a *discovery* mechanic, not a *review* mechanic.

**"Today's Word" — discovery, not review:**

1. **Morning push notification** (opt-in): "New word for you: [word] — from [Movie Title]. Tap to learn it." The framing is "here's something new," not "do you remember this?"
2. **Home screen card** shows a word from a popular movie at the user's CEFR level that they haven't saved yet. Includes: word, definition, in-movie sentence, movie poster thumbnail.
3. **"Save this word" button** on the card. If tapped, it goes into the notebook — growing the deck that makes SRS more valuable.
4. Below the card: "You have N saved words. Make sure you remember them → Plus."

**Why discovery, not review:**
- If we show a *saved* word daily and ask "do you remember?", we're delivering free recall practice — the exact thing SRS does. A free user who gets one review per day may never feel the need to pay for 10 reviews per day. The gap feels quantitative ("more of the same"), not qualitative ("a different product").
- If we show a *new* word daily, we're driving exploration and deck growth. The user's notebook gets bigger every day, which *increases* the pressure to review. The SRS pitch becomes: "You've saved 47 words across 5 movies. Are you actually going to remember all of them? → Plus." That's a qualitative gap — "you have a growing pile of words you'll forget without a system."
- Discovery words also drive engagement with new movies the user hasn't opened yet, which deepens catalog usage.

**Fallback if push notification opt-in is low (~50% on iOS):**
- In-app badge/dot on the home screen that refreshes daily.
- The card is always visible on the home screen whether or not the user came via push — the notification just increases the chance they open the app.

## 9. Phased rollout

### Phase 1 — Foundation (no user-visible monetization)
- [ ] Add `subscription_tier`, `subscription_expires_at` columns to `User`. Default everyone to `free`.
- [ ] Implement `is_premium(user)` helper. Admins return true unconditionally.
- [ ] Build admin grant/revoke UI (lightweight: search + grant + revoke, no audit table).
- [ ] Add `ads_eligible` flag.
- [ ] Build the saved-words notebook view.
- [ ] Build the word-of-the-day home screen card + push notification.
- [ ] Log every "Review your words" CTA tap behind a feature flag (baseline engagement data).

### Phase 2 — Ship Plus (SRS + ad-free)
- [ ] Leitner SRS scheduler.
- [ ] Review session UI (cards with definition + translation + sentence, got-it/forgot buttons).
- [ ] Free SRS preview behind feature flag (A/B test: 1 session / 3 sessions over 3 days / 7 days).
- [ ] Home-screen banner ad via AdMob (free users only).
- [ ] StoreKit / Google Play Billing: monthly + annual subscriptions.
- [ ] Wire the two paywall triggers (review CTA + Today's Word nudge).
- [ ] 7-day free trial flow (starts after free preview ends).
- [ ] Instrument: track preview-to-trial conversion rate per A/B variant.

### Phase 3 — Measure, decide, expand or pivot

**SRS conversion decision gate (2 weeks after Phase 2 launch):**

- [ ] Pick the A/B variant with the best preview-to-trial-to-paid funnel. Kill the other two.
- [ ] Measure overall: what % of free users who see the "Review your words" CTA tap it? Of those, what % start a trial? Of those, what % convert to paid?

**If SRS converts (>2% of CTA-viewers → paid):**
- [ ] Add memory analytics dashboard (retention rate, words due, streak).
- [ ] Add cross-movie example sentences (DeepL-powered).
- [ ] Add audio pronunciation.
- [ ] Consider adding a rewarded-video interstitial on movie-open if banner eCPM is too low (A/B test carefully).

**If SRS underperforms (<1% conversion after 4 weeks):**
- [ ] Diagnose the funnel — where does it break?
  - Users not saving words → the notebook/save UX is the problem, not the paywall.
  - Users not returning on day 2 → the habit loop is failing, fix Today's Word or push notifications.
  - Users tapping the CTA but not converting after preview → the preview dose is wrong, or SRS itself isn't compelling enough.
- [ ] Test fallback: ad-free at a lower price ($2.99/mo) without SRS.
- [ ] Test fallback: premium = audio + offline bundle (convenience, not memory). These have obvious tangible value and don't depend on users caring about retention science.
- [ ] If nothing converts: accept that the product is ad-supported, focus on growing free users, monetize through ads + optional cosmetic upgrades (themes, profile customization). This is a valid outcome, not a failure — it just means the premium hypothesis was wrong.

- [ ] Tune abuse rate limit on free ingestion based on real traffic.

## 10. Open questions

1. **Is SRS actually the thing users will pay for?** The entire plan bets on this. We have no data yet. The Phase 3 decision gate exists to answer this within 4 weeks of launch. If SRS doesn't convert, explicit fallback paths exist (§9).
2. **What's the right SRS preview dose?** The A/B test (1 session / 3 sessions / 7 days) will answer this empirically. The key metric is *preview-to-trial-to-paid* conversion rate, not just "did they try it."
3. **Is Today's Word enough to drive daily opens?** Push notification opt-in on iOS is ~50%. If opt-in is too low, the habit loop depends on the user independently opening the app and seeing the card. Fallback: in-app badge/dot that refreshes daily, plus consider email digest as a secondary channel.
4. **Banner-only ads: enough revenue?** Home-screen banner eCPM for education apps in emerging markets can be $0.50–$2 CPM. If this doesn't cover server costs for free users, we need to either add a carefully-placed rewarded video or accept that free users are a funnel cost, not a revenue source. Track ad revenue per DAU from day one.
5. **What user event proves payment readiness?** Is it opening the review CTA, finishing the free preview, or returning on day 2 after the preview? The A/B test should track all three and let us identify the actual conversion-critical moment.
6. **Free-tier pronunciation.** Should free get one cached TTS pronunciation per word? Probably yes (near-zero marginal cost after first hit). Decide before Phase 2.
7. **Trial length.** 7 days is conservative. For a memory product where value compounds over weeks, 14 might convert better. Test once we have volume.
8. **If SRS fails, what's next?** The plan lists fallbacks (ad-free at $2.99, audio+offline bundle, pure ad-supported). But we should commit now to which we test *first*, so we're not scrambling post-Phase-3. Current priority order: (1) ad-free at lower price, (2) audio+offline bundle, (3) accept ad-supported model.
9. **Web monetization.** This plan is mobile-first. The web app needs Stripe-driven Plus eventually. Can reuse the `entitlements` API.

## 11. Changelog

### v0.3 → v0.4

| Change | v0.3 | v0.4 | Why |
|---|---|---|---|
| Daily habit mechanic | Word from *saved deck* ("do you remember?") | Word from *catalog at user's level* ("here's something new") | Reviewers flagged that pulling from saved words creates a free mini-SRS that blurs the premium boundary. Discovery drives deck growth → increases SRS pressure. Review satisfies the recall need → undercuts the SRS pitch. |
| SRS preview | Fixed: 1 session, 10 cards | **A/B test: 1 session / 3 sessions / 7 days** | One session may not be enough to sell a memory product. The right dose is unknown, so ship all three behind a feature flag and let conversion data decide. |
| Phase 3 fallbacks | "If SRS doesn't convert, try $2.99 ad-free" | **Explicit ordered fallback paths** with diagnostic steps | Reviewers wanted more pivot flexibility. Now includes: diagnose funnel breakpoint → test ad-free at lower price → test audio+offline bundle → accept ad-supported model. |
| Upgrade nudge framing | "Review all N saved words → Plus" | "You have N saved words. Make sure you remember them → Plus" | Frames SRS as the *answer to a growing problem* (forgetting), not as "more of the same thing the daily card does." |
| Open questions | 7 questions | **9 questions**, including SRS fallback priority order and payment-readiness signals | Forces us to commit to a fallback plan before launch, not after failure. |

### v0.2 → v0.3

| Change | v0.2 | v0.3 | Why |
|---|---|---|---|
| Launch premium scope | 8+ features | **2 features (SRS + ad-free)** | Premature breadth. Don't build what we can't prove users want. |
| SRS preview | Hard paywall, no preview | **Free preview session** | Asking users to pay for something they've never tried is the weakest conversion pitch. |
| Daily habit loop | None | **Word-of-the-day card + push notification** | No mechanism to bring free users back on day 2. |
| Interstitial ad | On movie-open | **Removed at launch** | Sits inside the learning loop despite claiming otherwise. |
| Priority ingestion | Marketed premium benefit | **Internal QoS only** | Users won't pay for something invisible. |
| Lifetime pricing | $79 at launch | **Deferred** | Premature LTV anchoring risk. |
| Comp/admin infrastructure | Audit log table, full schema | **Lightweight** (app logs, minimal schema) | Overbuilt for current scale. |
| Paywall triggers | 6 triggers | **2 triggers** | Complexity without data. |
| Premium backlog | Implicit | **Explicit ordered list with decision gate** | Forces us to prove SRS converts before investing in supporting features. |

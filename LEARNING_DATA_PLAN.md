# Learning-Data Strategy — building an investable, legally-clean data asset

**Status:** Plan / proposal (not yet implemented)
**Owner:** TBD
**Created:** 2026-07-24
**Scope:** `apps/mobile` (the product) + `backend`. No `frontend/` work — see [CLAUDE.md](CLAUDE.md) "Mobile is the product; web is frozen".

---

## 0. TL;DR

WordWise already sits on a genuinely valuable dataset — per-word review outcomes, response latencies, spaced-repetition state, quiz retention, and movie engagement — but almost none of it is **instrumented as an analytics stream**, **surfaced as investor-facing metrics**, or **consented for the uses that make it valuable** (product research, model training, benchmarking efficacy). The transport in [analytics.ts](apps/mobile/src/services/analytics.ts) is a no-op in production, so today we capture learning *state* but not the learning *journey*.

This document proposes a phased plan to:

1. **Turn what we already store into a first-class learning-data asset** (an event stream + an efficacy layer), without re-collecting anything.
2. **Add the few high-value signals we're currently throwing away** (placement answers, session funnels, self-reported motivation/difficulty).
3. **Make the whole thing legally defensible** — consent tiers, purpose limitation, an anonymization pipeline, opt-out, and matching privacy-policy / store-label disclosures — so the dataset is an *asset* in due diligence rather than a liability.
4. **Expose it as investor-ready metrics** (retention cohorts, learning-efficacy, engagement) reusing our existing admin/health + snapshot patterns.

The companion effort — a **new-user welcome survey** to gather self-reported difficulty/frustration data — is tracked as a **separate GitHub issue** (see §9), because it's a self-contained feature; this doc is the umbrella strategy it plugs into.

---

## 1. Why learning data is an investable asset (research-backed)

The thesis investors respond to in language-learning / edtech is **data-as-a-moat**: a proprietary corpus of learner behavior that (a) improves the product in a loop competitors can't copy, and (b) proves the product actually works.

- **Data moat / network effect.** Duolingo's core defensibility argument to investors is its dataset of learner behavior feeding adaptive models — daily exercise volume in the billions, used to personalize and to open new verticals. The dataset *is* the moat. ([Nasdaq](https://www.nasdaq.com/articles/duolingo-ai-and-data-powering-scalable-growth-and-competitive-moat))
- **The data trains proprietary models.** Duolingo's Half-Life Regression / Birdbrain spaced-repetition models were trained on a released corpus of **~13M user-word learning traces** (recall rates, lag times between practices, morpho-lexical metadata). That is almost exactly the shape of what our `UserWord` + `QuizCardResult` tables already contain. ([Duolingo HLR paper](https://research.duolingo.com/papers/settles.acl16.pdf), [dataset/repo](https://github.com/duolingo/halflife-regression))
- **Efficacy sells at a premium.** Edtech companies that can *demonstrably* improve outcomes command higher valuations; an RCT showing measurable learning gains is a marketing and fundraising asset. ([FE International — EdTech valuation](https://www.feinternational.com/blog/edtech-business-valuation), [Duolingo RCT coverage](https://www.nasdaq.com/articles/duolingo-ai-and-data-powering-scalable-growth-and-competitive-moat))
- **The metrics investors actually underwrite** are engagement-backed **cohort retention**, **learning outcomes**, **LTV / LTV-to-CAC**, and **net revenue retention** — not raw registered-user counts. Cohort analysis (group by signup, watch behavior over time) is the unit of measurement. ([FasterCapital — EdTech KPIs](https://fastercapital.com/content/Edtech-metrics-and-KPIs--How-to-measure-and-report-your-Edtech-startup-s-performance-and-progress-to-your-angel-investors.html))

**What this means for what we collect.** To be investable, our data needs three properties the raw tables don't yet have:

| Property | Why investors care | Where we are today |
|---|---|---|
| **Longitudinal & cohorted** | Retention/efficacy are measured over time, per signup cohort | We have timestamps but no cohort/funnel layer |
| **Ties to an outcome** | "Users who did X learned Y% faster / retained Z% more" | We have `retentionScore` but don't compute/expose it as efficacy |
| **Legally usable for research/training** | Dirty-provenance data is a *liability* in an acquisition, not an asset | No consent-to-train; privacy policy doesn't cover research use |

The third row is the crux: **the same dataset is an asset or a liability depending entirely on consent and provenance.** That's why "legally" and "attractive to investors" are the same problem, handled in §5.

---

## 2. What we already collect (the hidden asset)

Before adding anything, note how much learner signal we already persist. This is the inventory to lead with in a data room.

- **Behavioral interaction stream** — [`UserWordInteraction`](backend/prisma/schema.prisma) via [interactions.py](backend/src/routes/interactions.py) (`POST /user/interactions`): `ROW_CLICK`, `TRANSLATION_VIEW`, `DEFINITION_VIEW`, `WORD_SAVE`, `WORD_UNSAVE`, each with a free-form `metadata` JSON and timestamp. This is a ready-made event table — it's just under-used.
- **Spaced-repetition memory traces** — [`UserWord`](backend/prisma/schema.prisma): Leitner `srsBox`, `srsDueAt`, `srsLastReviewedAt`, per user-word. This is the HLR-style trace ("when did they review, did it stick").
- **Quiz performance with latency** — [`QuizCardResult`](backend/prisma/schema.prisma): `isCorrect`, `selfRating` (`know`/`kinda`/`dont`), and **`answerMs`** (response time — a strong difficulty/confidence signal most apps don't retain per-card). Plus `QuizSession` (kind, stars, accuracy).
- **A native efficacy metric already exists** — [`UserQuizStats.retentionScore`](backend/prisma/schema.prisma): "% correct on re-quiz ≥7d later." This is *exactly* the number an efficacy pitch is built on; today it's computed but not surfaced.
- **Movie/content engagement** — `UserMovieProgress`, `UserWatchedMovie`, `UserReelMovie`: what content drives study, in what order, how far.
- **Cost & coverage telemetry** — `LlmUsageLedger`, [`VocabCoverageSnapshot`](backend/prisma/schema.prisma) (daily snapshots) — an existing pattern for time-series aggregates we can copy for engagement/efficacy snapshots.

**Gaps to close:**

1. **No behavioral funnel.** [analytics.ts](apps/mobile/src/services/analytics.ts) `track()` runs `consoleTransport` in dev and no-ops in prod. We emit almost nothing, and the events we do reference (`PAYWALL_VIEW`, `TRIAL_START_TAP`, `lesson_start`/`lesson_end` per the playbook) never reach a destination. So we can't build acquisition→activation→retention funnels or cohort curves — the investor-facing view.
2. **Placement answers are discarded.** [OnboardingFlow.tsx](apps/mobile/src/components/onboarding/OnboardingFlow.tsx) collects per-word `PlacementAnswer[]` and derives a CEFR level, then throws the raw answers away. Those are a labeled self-assessment dataset (word × claimed knowledge × derived level) we should persist.
3. **No self-reported motivation / difficulty / frustration.** We infer everything from behavior; we never ask *why* someone is here or *what's hard*. That's the welcome-survey issue (§9) and it's high-signal, cheap, and great for segmentation.
4. **No consent/purpose layer for research or model training.** The [privacy policy](apps/mobile/src/components/PrivacyScreen.tsx) discloses collection for SRS + personalization + ads — **not** for research, benchmarking, or training models / building a dataset asset. Using the data for those today would breach **purpose limitation** (§5).

---

## 3. What to add — mapped to investor value

Each proposed signal is listed with the investor question it answers. Prioritize the top block; it's cheap and reuses existing seams.

### 3.1 Wire the analytics transport (unlocks funnels & cohorts) — **P1**
- Choose a destination (PostHog / Amplitude / self-hosted) and implement an `AnalyticsTransport` passed to `setAnalyticsTransport()` at startup. The seam already exists; this is the single highest-leverage change.
- Standardize a small, stable event taxonomy (do **not** log free-form): `app_open`, `onboarding_step_view/complete`, `lesson_start/end`, `quiz_card_answered` (with `answerMs`, `isCorrect`), `word_saved`, `paywall_view`, `trial_start_tap`, `subscription_started`, `session_end`. Include `cohort_week`, `tier` (free/premium), `platform` (iOS/Android), `app_language`.
- **Investor question answered:** activation rate, D1/D7/D30 retention by cohort, free→paid conversion funnel, LTV inputs.

### 3.2 Persist placement answers — **P1 (cheap)**
- Store the raw `PlacementAnswer[]` from onboarding server-side (new lightweight table or a typed `UserWordInteraction` row) alongside the derived level.
- **Investor question answered:** where do self-assessment and demonstrated ability diverge (a proprietary calibration dataset); onboarding funnel drop-off by placement outcome.

### 3.3 Surface the efficacy layer we already compute — **P1**
- Build read models over `UserQuizStats.retentionScore`, `QuizCardResult`, and `UserWord` SRS transitions: **retention curve** (recall probability vs. days-since-review), **words-learned-per-active-hour**, **retention lift for actives vs. lapsed**.
- Copy the [`VocabCoverageSnapshot`](backend/prisma/schema.prisma) daily-snapshot pattern to store `EngagementSnapshot` / `EfficacySnapshot` rows so trends are queryable without recomputation.
- **Investor question answered:** "Does the product work?" — the efficacy/outcomes story that earns a valuation premium.

### 3.4 Self-reported survey data (welcome + periodic) — **P2** → tracked in [§9 GitHub issue]
- Welcome-page micro-survey: primary difficulty in learning vocabulary, difficulty watching with subtitles, frustration frequency, motivation/goal. Keep it ≤3–4 questions to protect completion rate (see §9).
- Optionally a light periodic in-app pulse (e.g. post-session sentiment) — gather over time rather than all upfront.
- **Investor question answered:** segmentation ("frustrated intermediate learners"), qualitative narrative for the deck, feature-prioritization evidence, churn-reason labels.

### 3.5 Session & content funnels — **P2**
- Derive study-session boundaries and content paths from existing progress tables + new events (movie → words studied → quiz → retention).
- **Investor question answered:** which content converts to learning; engagement depth per DAU.

---

## 4. Investor-facing metric layer

Don't hand investors raw tables — expose a curated, always-current metric surface. Reuse the existing admin/health pattern (there's already an `/admin/health/vocab-coverage` surface and daily snapshots).

- **Growth & retention:** signups, activation %, D1/D7/D30/D90 retention **by weekly cohort**, resurrection rate.
- **Monetization:** free→trial→paid conversion, MRR, churn, **LTV / LTV-to-CAC**, net revenue retention.
- **Engagement:** DAU/WAU/MAU + stickiness (DAU/MAU), sessions/user, minutes/session vs. daily goal.
- **Efficacy (the differentiator):** retention curve, words mastered per active hour, `retentionScore` distribution, placement-vs-demonstrated calibration.
- **Data-asset scale:** count of learning traces (user-word-review rows), labeled events, survey responses — the "13M traces" style headline number.

Delivery: an internal `/admin` dashboard first (fastest, no new vendor), optionally a periodic snapshot export for the data room. Keep aggregates **k-anonymized** (suppress cells below a small user threshold) so nothing individual leaks into a shared deck.

---

## 5. Legal & consent architecture (the "legally" requirement)

This is what converts the dataset from liability to asset. The governing principles from GDPR/CCPA and the app-store rules:

- **Purpose limitation (GDPR Art. 5).** Data collected "to provide the service" cannot be silently repurposed for research or **model training** — that needs a compatible-purpose assessment or a fresh legal basis/consent. Our current policy only covers SRS/personalization/ads, so §3's research & training uses require a policy update **before** any such use. ([terms.law — customer data for AI training](https://www.terms.law/2024/05/02/legalities-of-using-customer-data-for-ai-training/), [rock.law — GDPR/CCPA & AI training](https://www.rock.law/privacy-laws-apply-ai-training-customer-data-gdpr-ccpa-consent/))
- **Consent quality (GDPR).** Freely given, specific, informed, unambiguous — no pre-checked boxes, real choice without penalty. ([Secure Privacy — mobile app compliance](https://secureprivacy.ai/blog/app-privacy-compliance-guide))
- **CCPA/CPRA (updated regs effective 2026-01-01).** Opt-out of "sale"/"share," and note enforcement has ramped sharply. Selling or sharing a learner dataset triggers these directly. ([Pandectes — CCPA 2026](https://pandectes.io/blog/ccpa-in-2026-new-requirements-and-compliance-impacts/))
- **App-store disclosure.** Apple **App Privacy** labels (App Store Connect) and Google Play **Data Safety** form must **match** the in-app privacy policy; mismatches get apps pulled. Any new collection here means updating both. ([App Store/Play labels 2026](https://legalpolicygen.com/blog/app-store-privacy-labels-ios-google-play-2026), [Play Data Safety](https://respectlytics.com/blog/google-play-data-safety-guide/))
- **Anonymization removes GDPR scope.** Properly anonymized/aggregated data (irreversible, non-re-identifiable even when combined) generally falls outside GDPR — the safest basis for a *sellable/shareable* dataset and for training. Pseudonymization (reversible) does **not**. ([anonym.legal — GDPR ML anonymization](https://anonym.legal/blog/gdpr-compliant-ml-training-data-anonymization-2025))

### Proposed consent model — three tiers

1. **Service-necessary (no separate consent, disclosed):** the SRS/quiz/interaction data needed to run the app. Already covered.
2. **Product analytics & improvement (opt-out, disclosed at first run):** the §3.1 event stream, used pseudonymously to improve the product. GDPR-region users get a genuine choice at onboarding; others get clear disclosure + settings toggle.
3. **Research, benchmarking & model training / dataset use (explicit opt-in):** a **specific, granular, separately-toggled** consent. Off by default. Only opt-in users' data enters any research corpus or training set, and only after the anonymization pipeline below.

### Guardrails (build these, not just document them)

- **Anonymization pipeline** for any research/training/export dataset: strip direct identifiers, replace `userId` with a per-dataset salted pseudonym then aggregate/k-anonymize, drop free-text that could carry PII, apply small-cell suppression. Document it — provenance is a due-diligence checklist item.
- **Consent ledger:** persist consent state + version + timestamp per user (which policy version they agreed to), so we can prove basis and honor withdrawal. Model it near the User record.
- **Easy, honored opt-out / withdrawal** at any time from settings (reuse [SettingsScreen.tsx](apps/mobile/src/components/screens/SettingsScreen.tsx) + the existing account-deletion path). Withdrawal removes future use and flags the user out of the next dataset build.
- **Data minimization & retention:** collect only listed fields; set retention windows; don't hoard raw events indefinitely once aggregated.
- **Minors:** WordWise likely attracts under-18 learners → COPPA (US) / GDPR-K exposure. Decide the minimum age / whether to gate the opt-in tier for minors **before** launching tier 3. (Open decision — §8.)
- **Docs to update in lockstep:** [PrivacyScreen.tsx](apps/mobile/src/components/PrivacyScreen.tsx) content, the public web privacy policy (one of the frozen-but-required pages), Apple App Privacy labels, Google Play Data Safety form. All must agree.

**Sequencing rule:** No data collected under the old policy may be used for a §3 research/training purpose until (a) the policy is updated, (b) the consent tier ships, and (c) the anonymization pipeline exists. New consented collection is the clean path; retroactive repurposing is the risky one.

---

## 6. Phased implementation plan

Ordered by leverage-per-effort. Each phase is shippable on its own.

- **Phase 0 — Legal foundation (blocks tier-2/3 use).**
  Update privacy policy + store labels to cover analytics and (future) research/training; ship the consent tiers + consent ledger; add the settings opt-out. *No new behavioral use until this lands.*
- **Phase 1 — Instrument (unlock the funnel).**
  Wire a real `AnalyticsTransport`; define the event taxonomy; emit the core events (onboarding, lesson, quiz, paywall, subscription). Persist placement answers.
- **Phase 2 — Efficacy & metric layer.**
  Read models + `EngagementSnapshot`/`EfficacySnapshot` (copy `VocabCoverageSnapshot`); `/admin` dashboard for cohorts, retention curve, LTV.
- **Phase 3 — Self-reported layer.**
  Welcome survey (the §9 issue) + optional periodic pulse; join survey segments to behavioral cohorts.
- **Phase 4 — Dataset & training readiness.**
  Anonymization/export pipeline; documented provenance; first internal efficacy analysis (candidate for an RCT-style writeup).

### Engineering constraints to respect
- **Schema changes go through the manual-SQL flow**, not `prisma migrate` — see the "Prisma migration drift" note: write SQL in `backend/prisma/manual/`, apply to prod **before** merging, never hand-edit generated migrations. Any new table (consent ledger, placement answers, snapshots) follows this.
- **Reuse first** (per [CLAUDE.md](CLAUDE.md)): the `track()` seam, the `interactions.py` request pattern, the `VocabCoverageSnapshot` snapshot pattern, the admin/health surface. Don't build parallel machinery.
- **Mobile-only for product surfaces.** No `frontend/` changes except the *public* privacy-policy page (which is in the allowed frozen-page set and **must** stay accurate).
- **Tests ship with the feature** (per CLAUDE.md): logic/integration only in mobile (`__tests__/`), pytest for backend routes/read-models. e.g. consent-gating (an opted-out user's events never enter an export), event-emission on the funnel path, snapshot aggregation, k-anonymity suppression.
- **Free vs. premium:** verify the consent UI and any survey render for both tiers and both iOS/Android.
- **Cost:** an events pipeline and any LLM-assisted survey coding count against budgets — mind `LLM_COST_CAP_USD` and vendor event volume.

---

## 7. Risks & non-goals

- **Non-goal:** selling personal data. The asset is an *aggregated/anonymized* corpus + an efficacy story, not a PII broker play. Selling PII trips CCPA "sale/share" and torches trust.
- **Non-goal:** dark patterns to force consent. Coerced consent isn't valid consent and is worthless in due diligence.
- **Risk — provenance debt:** repurposing legacy data without a clean basis creates a *liability* an acquirer's counsel will find. Mitigate with the §5 sequencing rule.
- **Risk — over-collection:** each new field is a disclosure + retention obligation. Only collect what maps to a metric in §4.
- **Risk — survey fatigue / onboarding drop-off:** keep the welcome survey tiny and skippable; measure completion (§9).

---

## 8. Open decisions (need a human call)

1. **Analytics destination:** PostHog (self-host option, product-analytics native) vs. Amplitude vs. Segment-to-warehouse? Affects cost, data residency, and EU posture.
2. **EU/CCPA go-to-market scope now vs. later** — determines whether tier-2 must be opt-*in* (GDPR) from day one or can start as disclosed opt-out.
3. **Minors:** set a minimum age and/or exclude minors from tier-3 opt-in? (COPPA/GDPR-K.)
4. **Pursue an RCT/efficacy study** as a fundraising asset this cycle, or defer to Phase 4 output first?
5. **Consent-to-train now or later:** ship tier-3 opt-in immediately (start accruing a clean training corpus early) or defer until a model use case is concrete?

---

## 9. Companion work — new-user welcome survey (separate GitHub issue)

The self-reported layer (§3.4) is filed as its own issue because it's a self-contained mobile feature with its own UX and acceptance criteria: a short survey on/after the welcome page capturing the **hardest part of learning vocabulary**, **difficulty watching movies with subtitles**, **how often users get frustrated**, and **motivation/goal**. It plugs into this strategy as the first self-reported signal and must respect the same consent/disclosure rules (§5) and store its answers for cohort joins. See the issue for scope, questions, storage, and tests.

---

### Sources
- [Duolingo: AI and Data Powering Scalable Growth and Competitive Moat — Nasdaq](https://www.nasdaq.com/articles/duolingo-ai-and-data-powering-scalable-growth-and-competitive-moat)
- [A Trainable Spaced Repetition Model for Language Learning (Half-Life Regression) — Duolingo Research](https://research.duolingo.com/papers/settles.acl16.pdf) · [dataset/code](https://github.com/duolingo/halflife-regression)
- [EdTech Business Valuation 2026 — FE International](https://www.feinternational.com/blog/edtech-business-valuation)
- [EdTech metrics & KPIs for investors — FasterCapital](https://fastercapital.com/content/Edtech-metrics-and-KPIs--How-to-measure-and-report-your-Edtech-startup-s-performance-and-progress-to-your-angel-investors.html)
- [Legalities of Using Customer Data for AI Training — Terms.Law](https://www.terms.law/2024/05/02/legalities-of-using-customer-data-for-ai-training/)
- [How Privacy Laws Apply to AI Training on Customer Data (GDPR/CCPA) — Rock Law](https://www.rock.law/privacy-laws-apply-ai-training-customer-data-gdpr-ccpa-consent/)
- [Mobile App Privacy Compliance Guide (GDPR/CCPA) — Secure Privacy](https://secureprivacy.ai/blog/app-privacy-compliance-guide)
- [CCPA in 2026: New Requirements — Pandectes](https://pandectes.io/blog/ccpa-in-2026-new-requirements-and-compliance-impacts/)
- [App Store Privacy Labels & Play Data Safety 2026 — LegalPolicyGen](https://legalpolicygen.com/blog/app-store-privacy-labels-ios-google-play-2026) · [Play Data Safety guide](https://respectlytics.com/blog/google-play-data-safety-guide/)
- [GDPR-Compliant ML Training Data Anonymization — anonym.legal](https://anonym.legal/blog/gdpr-compliant-ml-training-data-anonymization-2025)
- [User Onboarding Surveys: what to ask — Appcues](https://www.appcues.com/blog/user-onboarding-surveys)

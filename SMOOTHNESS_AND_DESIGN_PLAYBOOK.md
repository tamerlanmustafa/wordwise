# How Top Apps Feel Fast & Polished — Top 10 Things WordWise Can Steal

Research notes from how **Duolingo**, **Chess.com**, and **Apple Design Award** apps win on
smoothness, layout, and *perceived* speed. The focus here is what your question asked for:
**how they stay fast with millions of users, and the illusions/tricks they use to feel instant.**

> **The core insight:** *Actual* performance and *perceived* performance are two different problems.
> Most of the "wow, this app is so smooth" feeling comes from perception tricks, not raw speed.
> Duolingo got a **60%+ reduction in *perceived* session-end latency without speeding up the
> backend at all** — they just showed the celebration animation first. That's the whole game.

WordWise stack context (so these are actionable): **FastAPI + Prisma/Postgres** backend,
**React web** frontend, **Expo / React Native** mobile, shared `packages/`. Wherever a tactic
applies to both web and mobile, put it in `packages/` so we don't write it twice (per CLAUDE.md).

---

## 1. Optimistic UI / "Frontend Prediction" — update the screen *before* the server replies

This is Duolingo's single biggest perceived-speed lever. The app **immediately updates state and UI
based on the *anticipated* backend result**, then reconciles when the real response arrives (or rolls
back on error). Same pattern Twitter/iMessage/WhatsApp/Trello use for likes, sends, and follows.

Duolingo applies it to:
- **Lesson counter / progress** — increments instantly, syncs later (also enables offline).
- **XP & leaderboards** — the client computes expected XP locally instead of waiting seconds for the backend.
- **Follow buttons** — flip visually before the server confirms, with a quiet pending indicator.

**The trick:** the user *cares about feedback, not confirmation*. Give them the result now.

**Trade-off they call out:** you duplicate state and business logic across client+server. So their rule is:
> *"If the user cares deeply, or the value affects monetization or fairness, wait for backend confirmation."*
> (e.g. don't fake gem/coin balances, payments, or competitive win/loss.)

**Apply to WordWise:** answer-correct feedback, XP gain, streak increment, "lesson complete", word
saved/favorited, follow/friend actions → all should flip instantly with local prediction and sync in
the background. Build one shared optimistic-mutation helper in `packages/` used by both web and mobile.

---

## 2. Skeleton screens, never spinners

Users shown **skeleton screens perceive load as ~30% faster** than a spinner — *for identical load
times*. A spinner creates uncertainty (no idea how long); a skeleton says "the page is already here,
we're just filling in details." Adding a **shimmer/pulse/sliding motion** shrinks perceived wait further.

**The trick:** reserve the real layout's shape up front so content **doesn't shift** when it lands
(no janky reflow), and the eye reads "almost done" instead of "stuck."

**Apply to WordWise:** replace loading spinners on the home/lesson/word-list/profile screens with
skeletons that mirror the final layout. One reusable `<Skeleton>` primitive in `packages/`
(RN + web variants), with a subtle animated shimmer.

---

## 3. The "elevator button trick" — play the reward animation, do the work behind it

Named after lobby mirrors next to elevators that make the wait feel shorter. Duolingo shows the
**celebratory session-end animation immediately** and runs the heavy XP/leaderboard/sync work *behind*
it. Result: **60%+ reduction in perceived session-end latency, more sessions completed, more DAU** —
with zero backend speedup.

**The trick:** cover slow work with something the user *wants to watch anyway*. The animation isn't
decoration, it's a latency mask.

**Apply to WordWise:** on lesson/quiz completion, fire the confetti / streak / "great job" animation
the instant the last answer is submitted. Persist results, recompute XP, and sync during those
1–2 seconds the user is enjoying the reward. Same for word-of-the-hour reveals and level-ups.

---

## 4. Defer everything non-essential off the startup path

Duolingo cut **startup time ~40%** and lifted entry-device app-open conversion **91% → 94.7%**
(users hitting a 5s+ cold start fell **39% → 8%**) by getting to the home screen first and hydrating
the rest later. Concrete wins:
- Removed an ads-library **WebView init from startup → saved ~1.5s** and kept **20,000 daily learners**
  who used to quit before the app even opened.
- Made the server-availability check **non-blocking → 15% faster startup**.
- **Delayed the leaderboard refresh by 5 seconds** so it didn't contend with critical startup work.

**The trick:** time-to-interactive is a *conversion* metric. Every blocking call before first paint
silently kills users on slow devices/networks.

**Apply to WordWise:** audit app launch. Anything not needed to render the home screen — analytics,
feature flags, leaderboard, non-critical images, third-party SDKs — defer until after first paint or
load lazily. On RN, watch JS bundle init and avoid heavy synchronous work in the root component.

---

## 5. Split big payloads; load only what's needed *right now*

Duolingo's course models had grown to **multi-megabyte files** → slow downloads *and* slow JSON
deserialization on cheap phones. They **sectioned courses into small chunks and fetched only the
current content**, which unblocked features and improved performance across the board.

**The trick:** the fastest request is the one you don't make. Don't ship the whole dataset to render
one screen.

**Apply to WordWise:** paginate/lazy-load word lists, decks, and lesson content. Don't hydrate the
entire course tree on launch — fetch the active unit/lesson on demand. On the FastAPI side, return
lean DTOs (only fields the screen needs) and add cursor pagination; avoid N+1 in Prisma queries.

---

## 6. Hit the Doherty Threshold: feedback in <400ms, <100ms feels *instant*

Classic IBM result (Doherty & Thadani, 1982): when the system responds in **under ~400ms** the user
stays in "action mode" and never perceives waiting; cross 400ms and the brain flips to "wait mode,"
breaks flow, and re-evaluates whether the task is worth it. Under ~100ms feels truly instantaneous.

**The trick:** even when the backend genuinely needs longer, return *lightweight* UI feedback within
**100–200ms** — a press state, a haptic tap, a skeleton, an optimistic update. The real data can land
slightly later; perceived response is already under the threshold.

**Apply to WordWise:** every tappable element needs an immediate pressed/active state (and a haptic on
mobile) within 100ms — buttons, answer choices, cards, nav. Never let a tap feel "dead" while a request
is in flight. Standardize this in a shared `<Pressable>`/button component.

---

## 7. Predictive prefetching — load the next screen before they ask for it

Prefetching turns slow loads into instant transitions by fetching the *next likely* resource during
idle time, so by the time the user taps, it's already cached. Web shops do it on link **hover/intent**;
apps do it by predicting the obvious next step.

**The trick:** users move predictably. The next lesson, the next card, the profile they're about to
open — start fetching it during the idle moment *before* the tap.

**Apply to WordWise:** prefetch the next lesson while the user is mid-current-lesson; prefetch the next
batch of flashcards before they finish the current one; warm the leaderboard/profile data when they're
idling on home. Cache results (React Query / SWR style) so repeat navigations are zero-latency. Guard
with confidence thresholds + cache invalidation so you don't waste bandwidth or show stale data.

---

## 8. Animate only GPU-cheap properties — protect 60/120fps

Frame budget is brutal: **16.7ms per frame at 60fps, 8ms at 120fps.** The reliable way to stay under it
is to animate **only `transform` and `opacity`**, which run on the GPU/compositor thread and skip the
expensive layout + paint steps. Jank almost always comes from layout recalculation during motion, too
many nested layers, or main-thread work mid-animation.

**The trick:** keep animations off the main/JS thread entirely. On React Native that means
**Reanimated** (worklets run on the UI thread); on web, prefer `transform`/`opacity` transitions and
`will-change`, avoid animating width/height/top/left.

**Timing feel:** <100ms = instantaneous, 100–500ms = responsive; use natural easing (ease-out for
entrances), not linear.

**Apply to WordWise:** move all transitions/card flips/progress fills to Reanimated on mobile and
transform/opacity on web. Audit any animation that animates layout properties and convert it.

---

## 9. Offline-first & resilience to flaky networks

Duolingo's frontend prediction doubles as offline support: progress is stored locally, lessons run
without a connection, and **stored sessions sync when connectivity returns.** This is also why the app
feels instant even on a great connection — it's reading local state, not round-tripping.

**The trick:** treat the network as an *enhancement*, not a dependency. Cache-first read, write locally,
sync in background. A flaky 3G user and a fast Wi-Fi user get the same instant UI.

**Apply to WordWise:** persist lesson progress, XP, streaks, and saved words locally
(AsyncStorage/MMKV on mobile, IndexedDB/localStorage on web) and reconcile with the backend on
reconnect. Queue mutations so a dropped connection mid-lesson never loses the user's work or blocks the UI.

---

## 10. Measure *perceived/conversion* metrics and A/B test relentlessly

Duolingo stopped optimizing raw latency and instead optimized **conversion** — e.g. "% of users who
actually reach the home screen" — and ran **200+ A/B tests in 2024**. They profile real traces
(Perfetto on Android), hunting two patterns: **idle gaps** (main thread blocked by slow background work)
and **long blocks** (frozen frames). They even built a bytecode/ASM tracer to auto-instrument methods
without 20-minute rebuilds.

**The trick:** "fast" is whatever moves the metric users feel. A 1.5s startup win was justified because
it *saved 20,000 daily learners*, not because a graph went down.

**Apply to WordWise:** instrument the three key journeys — **app open, lesson start, lesson end** — and
track completion/conversion, not just timing. Add lightweight tracing to find the main-thread blockers
on cheap Android devices, and A/B test perceived-speed changes (skeletons, optimistic UI, reward-first)
against retention/completion, not just load time.

---

## Honorable mentions (cheap wins worth doing)

- **Haptics on every meaningful action** (mobile) — correct answer, streak, level-up. Tiny taps make the
  app feel physical and responsive; pairs perfectly with #6.
- **Progressive / blurhash image loading** — show a blurred placeholder that sharpens, so images never
  pop in as empty boxes. Reserve their dimensions to prevent layout shift.
- **Minimal, purposeful layout (Apple HIG)** — award winners "get out of the way of the content."
  Consistent spacing, type scale, and one clear primary action per screen read as "premium" and reduce
  cognitive load. Keep web + mobile visually consistent via shared design tokens in `packages/`.
- **Smooth, consistent navigation transitions** — shared-element/state transitions between screens
  signal polish; the *consistency* of motion matters as much as the motion itself.
- **Progress indicators for unavoidable waits** — when something truly can't be faked, a progress bar
  (even an approximate one) makes the wait far more tolerable than a blank spinner.

---

## TL;DR priority order for WordWise

1. **Reward-first animations** on lesson/quiz complete (#3) — biggest perceived win, low effort.
2. **Optimistic UI** for answers, XP, streaks, follows (#1).
3. **Skeletons instead of spinners** everywhere (#2).
4. **Instant press states + haptics** within 100ms (#6, honorable-mention haptics).
5. **Defer non-critical startup work** to first paint (#4).
6. **Prefetch the next lesson/cards** (#7).
7. **Reanimated / GPU-only animations** (#8).
8. **Offline-first local state + background sync** (#1/#9).
9. **Split/paginate data, lean API DTOs** (#5).
10. **Instrument app-open / lesson-start / lesson-end + A/B test** (#10).

Put shared logic (optimistic mutations, skeletons, prefetch, design tokens) in `packages/` so web and
mobile stay in sync per CLAUDE.md.

---

## Sources

- [Duolingo — Seeing the future: frontend prediction in Duolingo's mobile app](https://blog.duolingo.com/frontend-prediction/)
- [Duolingo — Android app performance case study and DAU growth](https://blog.duolingo.com/android-app-performance/)
- [Mobile Vitals — Duolingo's Android Performance Case Study (summary)](https://mobile-vitals.com/article/2281-duolingo-duolingo-s-android-performance-case-study-and-dau-growth)
- [Android Developers Blog — How Duolingo Adopted MVVM for performance & velocity](https://android-developers.googleblog.com/2021/08/android-app-excellence-duolingo.html)
- [This One UI Decision Makes Apps Feel 10x Faster (optimistic UI / skeletons)](https://medium.com/@mohitphogat/this-one-ui-decision-makes-apps-feel-10x-faster-even-when-they-arent-be2b541054fe)
- [freeCodeCamp — How to Use Skeleton Screens to Improve Perceived Performance](https://www.freecodecamp.org/news/how-to-use-skeleton-screens-to-improve-perceived-website-performance/)
- [Skeleton Screens vs. Spinners — Optimizing Perceived Performance](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance)
- [The Psychology of Waiting: Skeletons](https://medium.com/@elenech/the-psychology-of-waiting-skeletons-ca3b309e12a2)
- [LogRocket — Designing for instant feedback: the Doherty Threshold](https://blog.logrocket.com/ux-design/designing-instant-feedback-doherty-threshold/)
- [Laws of UX — Doherty Threshold](https://lawsofux.com/doherty-threshold/)
- [Doherty Threshold: the 400ms rule + practical examples](https://markbuskbjerg.dk/en/ux-design/doherty-threshold/)
- [Motion.dev — Animation performance guide](https://motion.dev/docs/performance)
- [SitePoint — Achieve 60 FPS Mobile Animations with CSS3](https://www.sitepoint.com/achieve-60-fps-mobile-animations-with-css3/)
- [Prefetching in Modern Frontend: what, when, how](https://medium.com/@satyrorafa/prefetching-in-modern-frontend-what-it-is-when-to-use-it-and-how-to-optimize-performance-fe8af341d303)
- [How to Implement Prefetching Strategies](https://oneuptime.com/blog/post/2026-01-25-implement-prefetching-strategies/view)
- [Chess.com relies on Google Cloud as users and traffic surge](https://cloud.google.com/blog/products/ai-machine-learning/chess-com-relies-on-google-cloud-as-users-and-traffic-surges)
- [Chess.com upgrades to Cloud SQL Enterprise Plus](https://cloud.google.com/blog/products/databases/online-chess-platform-upgrades-to-cloud-sql-enterprise-plus)
- [Apple Design Awards — 2026 finalists](https://developer.apple.com/design/awards/)
- [Apple Design Awards — 2025 winners and finalists](https://developer.apple.com/design/awards/2025/)
- [Apple — Human Interface Guidelines](https://developer.apple.com/design/)

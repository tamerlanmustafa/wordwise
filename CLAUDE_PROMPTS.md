# WordWise Mobile — Claude Code implementation prompts

Companion to the Engagement UX Plan + mockups (`WordWise Mockups.dc.html`, options 1a–1e).
Scope: `apps/mobile` ONLY — `frontend/` is frozen per repo CLAUDE.md.

Paste one prompt per Claude Code session, in order. Each is self-contained.
Shared guardrails baked into every prompt:

- Tests land with the feature: pure logic + stores + services under `__tests__/`, no component-render library.
- Animations: transform/opacity only, `useNativeDriver: true`, respect Reduce Motion (`AccessibilityInfo.isReduceMotionEnabled`).
- Colors only via `useThemeColors()` tokens; fonts via `SERIF_FAMILY` / `MONO_FAMILY` from `src/theme/fonts.ts`.
- No emoji, no invented stats, no dark patterns.

---

## 0.1 — Emit canonical analytics events (P0)

```
In apps/mobile, wire the canonical analytics events through the existing seam in
src/services/analytics.ts (it logs in dev, no-ops in prod — do NOT add a vendor SDK
in this task, and do not change its public API unless an event needs a payload type).

Add typed event emissions at these call sites:
- app_open — core/App.tsx, once per cold start
- onboarding_step {step, index} — components/onboarding/OnboardingFlow.tsx, on every step transition
- onboarding_complete {ms_total} — same file, when the flow finishes
- home_view — components/screens/HomeScreen.tsx, on tab becoming visible
- tab_press {tab} — components/GlobalBottomBar.tsx, in onTabPress
- lesson_start {kind, index} / lesson_end {kind, correct, total, ms} — where PracticeScreen's
  onStartDailyReview lands (ReviewScreen/session flow) — find the session start/finish points
- review_start / review_end — the SRS review flow, same pattern
- streak_day {n} — where the streak increments after a completed session (dailyGoalStore or
  the post-session server-state refresh)
- chest_open {section} — the ChestReveal flow
- paywall_view {source} — where the 402 → paywall routing happens (see SrsPaywallError usage)

Requirements:
- One central union type for event names + payloads so a typo fails typecheck.
- Zero behavior change; events must never throw (wrap transport call).
- Unit tests in __tests__/: the typed emit helper forwards name+payload to the transport,
  and unknown events fail compilation (type-level test via expect-error comment).
Do not touch frontend/.
```

## 0.2 — Analytics transport (P0, after the destination decision)

```
In apps/mobile, plug {PostHog|Amplitude} into src/services/analytics.ts via its
setAnalyticsTransport() seam. Initialize in core/App.tsx behind the existing env/config
pattern (src/config/env.ts) with the API key from env — never hardcode. Call sites must
not change. Queue events fired before init and flush after. Respect a simple opt-out
flag if the Settings store has one; if not, add `analyticsEnabled` (default true) to the
settings store with a Settings row. Tests: queue-then-flush ordering, opt-out drops events.
```

## 1.1 — Move the notification permission ask after first value (P0, mockup 1b)

```
In apps/mobile, the OS notification permission dialog currently fires on app start:
core/App.tsx calls registerForPushNotifications() right after first render. Fix per
mockup 1b:

1. Remove the mount-time call from core/App.tsx.
2. Create components/common/NotifPrimerSheet.tsx — a bottom sheet in the house style
   (paper bg, radius 24 top, grab handle, 54px gold-tinted bell icon circle, serif title
   "One nudge a day. That's it.", body explaining the 9 AM reminder, gold primary
   "Remind me daily" [same geometry as ReelReady's primary: gold bg, radius 14,
   paddingVertical 15, 900 uppercase goldDeep text], quiet secondary "Not now").
   Use PressableScale for both buttons.
3. Trigger: first tap of "Start first lesson" on movies/ReelReady.tsx OR first completed
   session (whichever happens first). Gate with AsyncStorage key notif_primer_state:
   {status: 'unseen'|'declined'|'accepted', declinedAt?: string, declineCount: number}.
4. Only after the user taps "Remind me daily" call registerForPushNotifications() (the
   OS dialog). "Not now" → re-eligible after 7 days, max 2 total asks, then never again.
5. Analytics: notif_prompt_view / notif_prompt_accept / notif_prompt_decline (via the
   0.1 helper if merged; otherwise the analytics seam directly).
6. Tests in __tests__/: the eligibility reducer (pure function deciding show/skip from
   notif_primer_state + now) — cover unseen, declined<7d, declined>7d, declineCount=2,
   accepted.

Keep services/notifications.ts API unchanged otherwise. Do not touch frontend/.
```

## 2.1 — ContinueCard on Home (P0, mockup 1a ①)

```
In apps/mobile, add a "Continue" card pinned at the top of Home per mockup 1a. It is the
single primary action on the tab; the browse feed below is unchanged.

1. New components/home/ContinueCard.tsx. Layout (light tokens shown; use tc.*):
   paper card, marginHorizontal 18, radius 14, 1px tc.border, padding 13/14, shadow like
   TodayWordCard (0 6 14 rgba(0,0,0,0.08)); row: 46×66 poster thumb (TmdbPoster, radius 8)
   · flex column [eyebrow 9.5/900 ls1.8 tc.goldOnSurface uppercase; serif 18/700 title
   (SERIF_FAMILY); meta 12 tc.textSecondary] · 46px gold circular play button with 4px
   3D edge (face tc.gold over tc.nodeGoldEdge, like PracticeTile's face/edge pattern),
   goldDeep play glyph (react-native-svg).
2. Content decision (priority order), in a pure helper deriveContinueTarget(state):
   a) SRS review due (srsApi due count > 0) → eyebrow "CONTINUE · REVIEW", title
      "Review {due} words", meta "~{est} min"
   b) else next path lesson → eyebrow "CONTINUE · LESSON {cursor+1}", title from
      practicePathStore's kindAtIndex(cursor) label map (reuse TILE_LABELS strings),
      meta "{film} · {n} words · ~2 min" when the kind is movie-bound, else "{n} words · ~2 min"
   Export the helper from a plain module and unit-test it in __tests__/ (both branches +
   zero-due edge).
3. Mount in components/screens/HomeScreen.tsx inside the pinned headerStack, ABOVE the
   Word-of-the-Hour block, and include it in the same collapse-on-scroll animation
   (extend WORD_BLOCK_H accordingly or wrap both in the existing Animated.View — measure,
   don't hardcode twice).
4. Tap → the exact same session-start path the active Practice tile uses (lift the
   handler contract from PracticeScreen's onStartDailyReview prop — the tab-level parent
   already owns navigation; add the callback prop to HomeScreen rather than duplicating
   logic). Fire analytics resume_tap {target}.
5. Use PressableScale for the whole card. No new colors, no emoji.

Tests: deriveContinueTarget branches. Do not modify PracticeScreen behavior.
```

## 2.2 — Shared StreakChip in the Home header (P0, mockup 1a ②)

```
In apps/mobile, extract the streak pill that PracticeScreen renders (paper pill, 1px
border, flame Ionicon 15 tc.goldOnSurface, mono count, tiny DAYS label) into
components/common/StreakChip.tsx with props {count: number, icon?: 'flame'|'shield',
label?: string, compact?: boolean}. Replace PracticeScreen's two inline chips with it
(zero visual diff — copy the exact styles) and mount a flame instance in
components/home/HomeHeader.tsx between the eyebrow and the bell (see mockup 1a: header
becomes eyebrow · spacer · StreakChip · bell).

Data on Home: reuse the same source PracticeScreen uses — dailyApi.state() server value
preferred, useDailyGoalStore streak as optimistic fallback. Hoist that
"effectiveStreak" logic into a hook (hooks/useEffectiveStreak.ts) used by both screens
so the number can never disagree between tabs. Unit-test the hook's fallback logic in
__tests__/ (server present, server null, hydration pending).
```

## 2.3 — Daily-goal ring on the StreakChip (P1, mockup 1a ③)

```
In apps/mobile, add the daily-goal progress ring around the flame icon inside
components/common/StreakChip.tsx (built in 2.2), per mockup 1a:

- 24×24 SVG (react-native-svg): track circle r10.5 stroke 2.4 tc.divider; progress arc
  same geometry, tc.gold, strokeLinecap round, strokeDasharray/offset from progress
  0..1, rotated -90°.
- Progress source: dailyGoalStore (goal = 1 session/day for now → 0 or 1; write the
  math against a fraction so a future multi-session goal needs no rework).
- On transition to complete while Home is visible: animate strokeDashoffset over 300ms
  ease-out and fire haptics.success() IF the 4.1 haptics service exists (soft-import /
  optional call otherwise). Under Reduce Motion, jump to the final state with no sweep.
- The ring renders on the Home instance only when the chip receives showRing (Practice
  keeps its current look).

Tests: pure progress→dashoffset math in __tests__/.
```

## 3.1 — Tab bar feel (P1)

```
In apps/mobile/components/GlobalBottomBar.tsx, replace each TabBtn's TouchableOpacity
with PressableScale (ui/PressableScale.tsx) at scale 0.97, and on activation of a NEW
tab: (a) haptics.selection() from services/haptics.ts if present (optional call),
(b) a ≤150ms one-shot icon settle — scale 1 → 1.08 → 1 on the icon only, Animated
native driver, skipped under Reduce Motion and skipped when re-tapping the active tab.
Also emit analytics tab_press {tab} here if 0.1 isn't merged yet (dedupe if it is).
No layout, color, or icon changes. Test: none required beyond typecheck (pure visual),
but keep the settle duration and scale as named constants.
```

## 4.1 — Haptics service + first moments (P0, mockup 1d)

```
In apps/mobile, add haptics behind a service with a kill-switch. This adds a native
module (expo-haptics) — flag the EAS dev-client rebuild in the PR description.

1. npx expo install expo-haptics.
2. New src/services/haptics.ts exporting tick(), success(), heavy(), selection() —
   thin wrappers over expo-haptics (impactLight, notificationSuccess, impactHeavy,
   selectionAsync). Every call: (a) no-ops when the user disabled haptics in Settings,
   (b) no-ops under Reduce Motion? NO — haptics are independent of Reduce Motion; gate
   only on the Settings toggle, (c) never throws (catch + swallow), (d) is a no-op on
   web/unsupported platforms.
3. Settings: add hapticsEnabled (default true) to the settings/preferences store with a
   toggle row in the Settings screen, house switch style.
4. Wire the map from mockup 1d — and ONLY these moments:
   - PressableScale press-in → tick()   (the TODO already in ui/PressableScale.tsx;
     add a `haptic` prop defaulting true so individual callers can opt out)
   - correct answer in quiz/MCQChoice + TranslationTypeCard flows → success()
   - daily goal hit / streak extend (where streak_day increments) → success()
   - ChestReveal open + MilestoneUnlockModal → heavy()
   Wrong answers get NOTHING (see 4.3 — visual shake only).
5. Tests in __tests__/: the service respects the disabled flag, swallows errors
   (mock expo-haptics to throw), and the exported names map to the right expo calls.
```

## 4.3 — Wrong-answer shake (P1, mockup 1d ①)

```
In apps/mobile, add a gentle shake to wrong quiz answers, per mockup 1d:

- New hooks/useShake.ts: returns {translateX: Animated.Value, shake()}. shake() runs a
  translateX sequence 0 → -6 → 6 → -4 → 2 → 0 over ~420ms total (Animated.sequence of
  timing steps, useNativeDriver: true). When Reduce Motion is on, shake() resolves
  immediately with no movement.
- Apply in quiz/MCQChoice.tsx: wrap the row in Animated.View bound to the hook's
  translateX; trigger shake() when state transitions to 'wrong' (the errorTint/border
  flash already handles color). Same trigger in the translation-typing card's wrong path
  (TranslationTypeCard).
- No haptic on wrong answers.
- Tests: the hook's step sequence values + reduce-motion early-exit (mock
  AccessibilityInfo), in __tests__/.
```

## 5.1 — Streak-aware reminders (P1, mockup 1e)

```
In apps/mobile/src/services/notifications.ts, make the daily reminder reflect real
state, per mockup 1e:

1. Pure function buildReminderContent(input: {streakDay: number, dueCount: number,
   currentFilmTitle: string | null}): {title, body}:
   - dueCount > 0 → title "Day {n} · {due} words due", body "Two minutes keeps the
     streak{film ? ` — ${film} is waiting.` : '.'}"
   - dueCount = 0 → title "Day {n}", body "A quick 8-word set keeps it going."
   Copy rules: never mention losing the streak (freezes may cover it), no emoji, no
   fake urgency.
2. Scheduling: when the reminder is (re)scheduled, fetch dailyApi.state() + due count
   and pass real values; fall back to the generic copy on network failure.
3. Cancel tonight's reminder when the daily goal completes (hook into the same place
   streak_day/goal-complete fires); reschedule tomorrow's at the user's picked time.
4. Tapping the notification deep-links to the Continue target (2.1) — wire through the
   existing notification-response listener.
5. Tests in __tests__/: buildReminderContent all branches (due>0 with/without film,
   due=0), and the cancel-on-goal-complete call path with mocked expo-notifications.
```

## 5.2 — Milestone proximity cue on the path (P1, mockup 1c ①)

```
In apps/mobile, add the goal-gradient cue to the Practice path, per mockup 1c:

1. In components/practice/PracticeTilePath.tsx, milestones are the section starts
   (SECTION_SIZE = 5, chest at each section boundary — reuse whatever renders the chest
   today; if chests are currently only in the journey surface, render the next section
   divider's chest tile inline at the boundary). Compute distance = nextMilestoneIndex -
   cursor with a pure exported helper nextMilestoneDistance(cursor): number (unit-test:
   cursor at 0, mid-section, boundary).
2. When distance <= 2: the milestone tile gets a 2px tc.gold border + a callout below it
   with the exact START-callout geometry from PracticeTile (8px rotated-square tail +
   rounded body) but gold: body bg tc.gold, text tc.goldDeep, label "{distance} SETS
   AWAY" (singular "1 SET AWAY").
3. The label only counts down (recompute from cursor; it can never increase within a
   session). At distance 0 the existing chest-open flow takes over (heavy haptic via 4.1).
4. Accessibility: accessibilityLabel "Chest {distance} lessons away".
5. Analytics: milestone_cue_view {distance} once per session per milestone.
Tests: nextMilestoneDistance + the show/hide threshold logic in __tests__/.
```

## 6.1 — Card-deck view mode on MovieDetail (mockup 2a)

```
In apps/mobile, add a "Cards" view mode to the movie vocabulary screen per mockup 2a
(mockup-2a-card-deck.png). Rows stay the DEFAULT; cards are a toggle. All existing
functionality must work identically in both modes.

1. View toggle. In components/screens/MovieDetailScreen.tsx, add a small segmented
   rows/cards toggle at the right of the count/sort row (two 28×22 icon segments in a
   paper pill, active segment white bg + shadow). Persist the choice in AsyncStorage
   key `vocab_view_mode` ('rows' | 'cards', default 'rows'), read on mount. The level
   tabs, For You tab, sort control, and header behavior (docked/expanded) are unchanged
   and shared by both modes.

2. New components/vocabulary/WordCardDeck.tsx. Renders ONE focused card + up to two
   stacked edges behind it (scale 0.96 / 0.92, opacity 0.7 / 0.45 — pure styling, not
   real rows). Fed by the SAME data MovieDetailScreen already computes for the list:
   activeItems (post level-tab + sort), batch sentence previews, learned/saved sets.
   Card anatomy (reuse VocabRow's pieces and styles wherever possible):
   - top row: mono rank number · level chip · spacer · ☆ save toggle (same handler as
     the row's handleSaveWord)
   - serif word (SERIF_FAMILY, ~34px) with inline translation "· {translation}" +
     source-language chip once loaded
   - sentence-in-context with the gold highlighted target word (same batch preview
     source as rows)
   - sentence translation under a 2px gold left bar — fetched ON TAP of the card via
     the exact translate() + cache path VocabRow's expansion uses (contentLoaded
     pattern); never prefetch the whole deck
   - footer: "⚐ Report an issue" + 🔊 pronounce, same handlers as the expanded row
3. Actions under the deck (all PressableScale):
   - 54px circle, teal ✓ ring = "I know this" → the row's handleMarkLearned, keeping
     the existing 5s undo snackbar; card flies left ~300ms (transform/opacity,
     useNativeDriver) then the next card promotes
   - "⚑ Leave off here" pill = recordBookmark(word, {explicit: true}) — same as rows
   - 54px gold circle with the 3D edge (face tc.gold over tc.nodeGoldEdge, like
     PracticeTile) → next card; word stays in rotation
4. Gestures mirror the buttons: pan left past ~90pt = I know this, right = next
   (same threshold as BookmarkRowWrapper). Under Reduce Motion: no fly animation,
   instant swap. Buttons must fully cover the gesture actions.
5. Cursor = bookmark. Every advance writes the same movie_bookmark_{id} the rows use
   (explicit: false). Entering cards mode starts from readBookmark's word if present,
   else index 0. A "⚑ Resumed at your bookmark · card {n}" chip shows at deck top when
   restored (same copy pattern as the rows' resume pill). Progress: "CARD {n} / {total}"
   mono label + 3px gold progress bar under the count row.
6. Learned cards leave the deck (rotation skips them) exactly like rows disappear from
   the list; saved state reflects instantly on the ☆.
7. Analytics (0.1 helper if merged, else the seam): vocab_view_toggle {mode},
   deck_advance {method: 'swipe'|'button'}, deck_mark_learned, deck_bookmark.
8. Tests in __tests__/ (pure logic only): the deck-cursor reducer (advance / mark
   learned skips / restore-from-bookmark / end-of-deck), view-mode persistence
   round-trip, and the swipe-threshold decision function.

Do not change VocabRow, the rows list, or frontend/.
```

---

### Suggested PR batching

1. **PR 1 (P0 instrumentation):** 0.1 → 0.2
2. **PR 2 (P0 native batch — one EAS rebuild):** 4.1 (+ 3.1 since it consumes haptics)
3. **PR 3 (P0 home):** 2.1 + 2.2 (ContinueCard + StreakChip share the header diff)
4. **PR 4 (P0 permission):** 1.1
5. **PR 5 (P1 polish):** 2.3 + 4.3
6. **PR 6 (P1 retention):** 5.1 + 5.2

# WordWise — implement two-tab redesign (Claude Code prompt)

You are implementing a **navigation + visual redesign** of the WordWise mobile app (`apps/mobile/`, React Native + Expo, TypeScript).

The HTML / JSX templates we're matching live in this repo at:
- `tabs/WordWise Tabs.html` (canvas host)
- `tabs/my-movies.jsx` (My Movies tab)
- `tabs/practice.jsx`   (Practice tab)
- `tabs/data.js`        (sample data — for reference only; **do NOT port** — use the real stores/API)

Read those first. They are the source of truth for layout, color, spacing, type and component composition. Pixel values map 1:1 to React Native (no rem/em conversion).

---

## 1. What changes at the navigation level

**Remove** the Journey / Reel surface entirely:
- Delete the **`Journey` tab** from `GlobalBottomBar` (`apps/mobile/src/components/GlobalBottomBar.tsx`).
- Delete (or archive under `_deprecated/`):
  - `apps/mobile/src/components/JourneyScreen.tsx`
  - `apps/mobile/src/components/journey/JourneyReelBackground.tsx`
  - `apps/mobile/src/components/journey/JourneyReelSprockets.tsx`
  - `apps/mobile/src/components/journey/JourneyConnector.tsx`
  - `apps/mobile/src/components/journey/JourneyNode.tsx`
  - `apps/mobile/src/components/journey/MovieTile.tsx`
  - `apps/mobile/src/components/journey/useJourneyLayout.ts`
- Keep these — they're reused by the new Practice tab:
  - `journey/ChestReveal.tsx`
  - `journey/MilestoneUnlockModal.tsx`
  - `journey/ReadyToWatchShelf.tsx` (now optional; surface in My Movies empty state)
  - `common/TipPopup.tsx`
- Route the `onOpenMoviePreview` flow from the new **My Movies** screen instead of JourneyScreen. The hub itself (`MoviePreviewHub.tsx`) is unchanged.

**Add** two new tabs to `GlobalBottomBar`:

| Tab id | Label | Icon | Screen |
|---|---|---|---|
| `home` | Home | home | existing `HomeScreen` |
| `movies` | **My Movies** | film | **NEW** `MyMoviesScreen.tsx` |
| `practice` | **Practice** | spark | **NEW** `PracticeScreen.tsx` |
| `profile` | Profile | user | existing |

Icons: stroked, 22px, 1.9 weight, rounded caps. Match the SVG shapes in `tabs/my-movies.jsx` → `NavIcon` exactly (translate to `react-native-svg`).

Nav bar styling:
- height 78, paddingBottom 18, paddingTop 8
- bg `tc.tabBg` (a new token — see §3)
- top border `tc.tabBorder`
- Active item: icon stroke = `tc.gold`, label color = `tc.text`. Inactive: both `tc.textFaint`.

---

## 2. My Movies tab (`MyMoviesScreen.tsx`)

Flat, sortable, filterable list of the user's added movies. Replaces the rejected film-reel zigzag entirely.

### Data source
- Use the existing `reelStore` (rename it to `myMoviesStore` in a follow-up commit — for now alias). Tiles come from `useReelStore(s => s.tiles)`.
- Each row shows: poster, serif title, year, director (if available), runtime (if available), CEFR badge, progress bar, `wordsKnown / totalWords` ratio, `%`.
- `tile.comprehensibility_percent` drives the progress bar.
- Tap row → existing `MoviePreviewHub` flow (`onOpenMoviePreview({ tileIndex, level, tile })`).
- "+" FAB → existing search/add flow (open `HomeScreen` search modal or `MovieSearchScreen` — match what's already used).

### Layout (translate `tabs/my-movies.jsx` to RN)
Top → bottom, all inside a `SafeAreaView` with `edges={['top']}` so the iOS status bar / dynamic island is never overlapped:

1. **Header row**
   - Eyebrow: `YOUR LIBRARY` — 10px, weight 900, letterSpacing 2, color `tc.goldOnSurface`, uppercase.
   - Title: `My Movies` — Source Serif 4, 30px, weight 600, letterSpacing -0.8.
   - Right side: 2× 38px circular icon buttons (Search, Filter). bg `tc.chipBg`, 1px `tc.border`.
2. **Stat strip card** (radius 14, bg `tc.paper`, 1px `tc.border`, soft shadow):
   - 3 stats separated by 1×28 vertical dividers (`tc.divider`):
     `{movies.length} films` · `{totalWordsKnown} words known` · `{avgComprehension}% avg comp.` (third stat uses `tc.goldOnSurface`).
3. **Filter chips row** — horizontal scroll, 7px gap:
   - `All`, `In progress` (0 < progress < 100), `Mastered` (progress = 100), `Not started` (progress = 0), then CEFR chips for any level the user has at least one movie in (`B1`, `B2`, `C1`, etc.).
   - Active chip: bg `tc.text`, color `tc.gold`. Inactive: bg `tc.chipBg`, color `tc.text2`, 1px `tc.border`. Padding 7×13, radius 999, weight 800, 12px.
4. **Sort row**:
   - Left: `${count} films · sorted by` — 11px, weight 800, letterSpacing 1.4, uppercase, color `tc.text3`.
   - Right: a pill with the current sort label + `▼`. Tap → ActionSheet:
     `Recently added`, `Title (A–Z)`, `Year (newest)`, `Year (oldest)`, `Comprehension (high)`, `Comprehension (low)`, `CEFR (easy→hard)`, `Rating (TMDB)`.
   - Persist the choice in `myMoviesStore` (new `sortBy` slice + AsyncStorage).
5. **List card** — radius 14, bg `tc.paper`, 1px `tc.border`, soft shadow, contains all rows. Each row:
   - 56×84 poster, radius 6, with a corner CEFR badge (top-left, 9px, weight 900, padding 1×5, radius 3, bg = `cefrColors[level]`, color white).
   - Title: Source Serif 4, 17px, weight 600, letterSpacing -0.3, line-height 1.1, **truncate at 1 line**.
   - Meta line: `${year} · ${director} · ${runtime}` — 11.5px, weight 600, color `tc.text3`.
   - Progress bar: 4px tall, bg `tc.divider`, fill = `tc.gold` when 100% else `cefrColors[level]`. Right of bar: `${known}/${total} · ${percent}%` in JetBrains Mono, 10.5px, weight 800, color `tc.text2`.
   - 18px `›` chevron at right, color `tc.text3`.
6. **FAB** — 56×56, radius 28, bg `tc.gold`, `+` glyph 28px weight 300 color `tc.goldDeep`. Positioned 22 right / 96 bottom (clears bottom nav). Drop-shadow uses gold-tinted blur.
7. **Empty state** (when list is empty after filters): "No films match — try clearing filters" + a reset CTA. When the underlying list is empty (no movies added at all): show a 2-column grid of `ReadyToWatchShelf` recommendations as the empty state.

### Files to create
- `apps/mobile/src/components/MyMoviesScreen.tsx`
- `apps/mobile/src/components/myMovies/MovieRow.tsx` (extracted row)
- `apps/mobile/src/components/myMovies/FilterChips.tsx`
- `apps/mobile/src/components/myMovies/SortPill.tsx`
- `apps/mobile/src/stores/myMoviesStore.ts` (sort + filter state, AsyncStorage-backed)

---

## 3. Practice tab (`PracticeScreen.tsx`)

Duolingo-style learning path — daily SRS hero on top, then a vertical zigzag of lesson nodes grouped under per-movie "units."

### Data source
- Daily SRS hero → same `dailyGoalStore` + `srsApi.startSession()` flow `JourneyScreen` was using.
- Streak chip → `dailyGoalStore.streak`.
- Units → derive from `myMoviesStore.tiles`: each in-progress movie becomes a unit. Per-unit lesson list is built from existing `quizApi` / `srsApi` endpoints — talk to `services/api.ts` to find the right call (look for `lessonSets`, `getMovieLessons`, or similar). If none exists yet, expose a stubbed `practiceApi.listUnits()` in `services/api.ts` that returns `{ unitId, movieId, title, poster, level, lessons: [...] }` and wire one endpoint server-side. **Don't hard-code the units.**

### Layout

1. **Header row** (inside `SafeAreaView edges={['top']}`):
   - Eyebrow `DAILY PRACTICE`, title `Practice` (same type spec as My Movies header).
   - Right: streak pill — bg `tc.paper`, 1px `tc.border`, soft shadow. Content: `🔥 {streak} DAYS`.
2. **Daily review hero card** (radius 16, bg `tc.gold`, color `tc.goldDeep`):
   - Left edge has a perforation strip (a vertical `linear-gradient(goldDeep 50%, transparent 50%)` repeating at 12px) at 25% opacity. This is the **only** filmic flourish kept from the v0.6 reel direction — it's enough to nod at the brand without dragging the whole reel back.
   - Eyebrow `TODAY'S REVIEW`, headline `12 words · ~2 min` (Source Serif 4, 24px, weight 700).
   - Pill CTA `START SESSION →` — bg `tc.goldDeep`, color `tc.gold`. Side note `+25 XP · keeps streak`.
   - Tap → existing `ReviewScreen`. The card auto-collapses to a "Today's done · 🔥 N" compact pill once `dailyDoneToday` is true.
3. **Mini-stats row** — 3 cards: `⭐ {xpToday} XP today`, `📚 {wordsKnown} words`, `🎬 {inProgressCount} in progress`. Radius 12, bg `tc.paper`, 1px `tc.border`.
4. **`YOUR STUDY PATH` section header** with `See all` link.
5. **Units** — for each:
   - **Marquee header strip** (radius 14, bg `tc.paper`, 1px `tc.border`):
     - 46×68 poster on left.
     - Eyebrow `UNIT · NOW SHOWING` in `tc.goldOnSurface`.
     - Title (Source Serif 4, 18px, weight 600).
     - CEFR badge + tagline line.
     - Done/total chip on right (`tc.chipBg`, monospace).
     - Tiny marquee-bulb row across the top edge (10 dots, alternating gold/transparent, 6px glow).
   - **Lesson path**: 5 nodes per unit, gently zigzagged with x-offsets `[0, 56, 24, -32, -8]` (px), each 76×76 hit area / 68px circle body. Connectors are SVG lines (gold + solid when previous lesson is `done`, `tc.divider` + dashed `4 6` otherwise).
   - **Node states**:
     - `done` → bg `tc.gold`, check glyph.
     - `active` → bg `tc.gold`, kind-glyph, **plus a spinning dashed gold ring** (2.5px dashed `tc.lessonRing`, inset -10px, css `animation: wwSpin 18s linear infinite` → in RN use a `react-native-reanimated` rotation loop). A `START` callout badge sits 78px below pointing up.
     - `locked` → bg `tc.nodeLocked`, 2px border `tc.nodeLockedB`, lock glyph, color `tc.text3`.
   - **Kind glyphs**: `recall` (chat bubble), `mcq` (4-square grid), `listen` (headphones), `chest` (treasure chest), `star` (filled star — used for the mastery node).
   - Drop-shadow on nodes is a "stacked" look — primary shadow `0 6 0 rgba(0,0,0,.45)` then secondary blur. Translate to RN via `shadowOffset.height = 6, shadowRadius = 0, shadowOpacity = 0.45` plus a second `elevation` layer if needed.
   - Tap node → `SetIntroScreen` (existing) for that movie + lesson, then `QuizLessonScreen` → `QuizResultScreen`.
6. **`INTERMISSION` divider** between units — `text3`, weight 800, letterSpacing 1.4, horizontal hairlines either side.
7. Bottom 32px breathing space before the nav.

### Files to create
- `apps/mobile/src/components/PracticeScreen.tsx`
- `apps/mobile/src/components/practice/DailyReviewHero.tsx`
- `apps/mobile/src/components/practice/UnitMarquee.tsx`
- `apps/mobile/src/components/practice/UnitPath.tsx`
- `apps/mobile/src/components/practice/LessonNode.tsx`
- `apps/mobile/src/components/practice/LessonConnector.tsx`

---

## 4. New theme tokens

Add to `apps/mobile/src/theme/tokens.ts` in BOTH `light` and `dark` blocks, and to the `ThemeColors` interface. All keys are new — no collisions.

| Token | Light value | Dark value | Notes |
|---|---|---|---|
| `tabBg` | `rgba(255,253,247,0.96)` | `rgba(20,18,28,0.92)` | Bottom nav fill |
| `tabBorder` | `#E5DCC4` | `rgba(255,255,255,0.08)` | Bottom nav top border |
| `chipBg` | `#EEE6D2` | `rgba(255,255,255,0.06)` | Inactive filter chips, icon buttons |
| `heroGlow` | — (CSS gradient, store as a literal string) | — | Practice screen warm top vignette |
| `lessonRing` | `rgba(197,139,27,0.55)` | `rgba(255,209,102,0.45)` | Active lesson dashed ring |
| `nodeLocked` | `#E5DCC4` | `#2a2935` | Locked lesson node fill |
| `nodeLockedBorder` | `#D7CCB0` | `rgba(255,255,255,0.06)` | Locked lesson node border |

Also confirm/adjust existing tokens for light mode warmth:
- `background` in light: `#F4EFE3` (currently `#EDE8F5` purple-tinted) — switch to the warm contact-sheet cream so the cinema theme reads in daylight. Update HomeScreen + any other screen that depends on `tc.background` and visually sanity-check.
- Light-mode `gold`: keep `#FFD166` for surfaces against dark only; introduce a deeper gold (`#C58B1B`) for text/strokes on light surfaces — already covered by existing `goldOnSurface: '#8B5A00'`. Use `goldOnSurface` everywhere on light, `gold` on dark.

---

## 5. Light mode philosophy

The light palette is a **warm sun-bleached contact-sheet**, not a "neutral white" theme:
- Paper: warm cream `#F4EFE3`.
- Text: deep brown `#2D2418`, not blue-grey.
- Gold accent: a muted ochre `#C58B1B` for strokes/text; gold tile fills stay `#FFD166` with `#3a2400` text-on-gold.
- The aesthetic should evoke a film archive's daylight reading room, not a generic light-mode flip. Reuse this language in copy ("Now Showing", "Intermission", "Final Cut", "Director's Cut").

---

## 6. Acceptance criteria

- [ ] Old `JourneyScreen` is not reachable from anywhere in nav.
- [ ] `My Movies` tab renders the user's reel as a flat sortable list. All 8 sort options work and persist.
- [ ] All 4 filter chips + dynamic CEFR chips work.
- [ ] `Practice` tab shows the daily SRS hero, mini stats, and at least 1 unit with 5 lesson nodes. Active lesson has the spinning gold ring.
- [ ] Both screens render correctly in light and dark via `useThemeColors()` — no hard-coded hex.
- [ ] No content overlaps the iOS dynamic island / status bar. Use `SafeAreaView edges={['top']}` consistently.
- [ ] Bottom nav uses the new icons and is height 78, paddingBottom 18.
- [ ] All new tokens added to `ThemeColors` interface + both blocks in `tokens.ts`.
- [ ] No `console.warn`/`console.error` on cold start of either screen.
- [ ] `npm run typecheck` is clean.

Refer back to the source HTML/JSX in `tabs/` whenever a layout question is ambiguous — those files have the final word on spacing, color, type and composition.

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

---

## 7. Quiz screens — synonym MCQ + translation typing

Templates: `tabs/quiz.jsx` (`SynonymMCQScreen`, `TranslationTypeScreen`).

Both screens reuse a shared header — implement once as `apps/mobile/src/components/quiz/QuizHeader.tsx`:
- 62px top safe-area inset (so it clears the dynamic island).
- Row: 36×36 round back button (chip bg + border, chevron-left glyph) · centered movie chip (1.5px gold border, radius 999, CEFR mini-badge + movie title in Source Serif 4 17px) · 36×36 round `N/total` counter (monospace).
- 4px gold progress bar at `index / total` fill.

### 7.1 Synonym MCQ (`card_type: 'synonym_mcq'`)

Wire into the existing card type that `ReviewScreen` and `QuizLessonScreen` already handle.

Layout:
1. `Pick the synonym` eyebrow — 11px, weight 900, letterSpacing 1.8, color `tc.goldOnSurface`, uppercase, centered.
2. **Word card**: radius 18, bg `tc.wordBoxBg` (new token — see §4 update below), 1px `tc.border`, soft shadow, centered. Word in Source Serif 4 36px weight 600. Below: `${pos} · "${exampleSentence}"` italic 12px `tc.text3`.
3. **4 stacked choices** (NOT 2×2 — easier to read on phone, bigger hit targets). Each choice is a row card: 14px radius, 2px border, padding 18×14, choice text in Source Serif 4 17px weight 600.
4. Sticky bottom CTA bar: padding 12×18, top border `tc.divider`. CTA is a full-width gold pill ("Check answer"). After answering, CTA flips per state:
   - correct → success-green pill "Continue →" (auto-advance after 600ms anyway).
   - wrong → red pill "Got it · Continue →".

Choice state matrix:

| State | Border | Bg | Text color | Right glyph | When |
|---|---|---|---|---|---|
| idle | `tc.border` | `tc.paper` (+shadow) | `tc.text` | — | default |
| correct | `tc.successBorder` (new) | `tc.successTint` | `tc.success` | check (green) | user tapped the right one |
| wrong | `tc.errorBorder` (new) | `tc.errorTint` | `tc.error` | × (red) | user tapped a wrong one |
| reveal-correct | `tc.successBorder` | `tc.successTint` | `tc.success` | check (green) | "the actual right answer" highlighted when user got it wrong |

After a wrong answer, render a callout below the choices: red-tinted card with `NOT QUITE` eyebrow and `{correctChoice} is the closest synonym.` body.

Interaction:
- Tap on a choice in `idle` → set state to correct/wrong, animate other choices to disabled (opacity 0.4, no border change), reveal the correct-answer green flash on the actual right one. No "Check" step — the tap IS the answer.
- 600ms after the tap, primary CTA enables and pulses once (`withSequence` scale 1 → 1.04 → 1`, 300ms).
- Tap CTA → record outcome via existing `srsApi.review()` / `quizApi.recordAnswer()` and advance.

### 7.2 Translation typing (`card_type: 'type'`)

Layout:
1. `Type the translation` eyebrow.
2. Word card (same component as MCQ).
3. **Hint chip row** — horizontal, centered, wrap allowed, 6px gap. Each chip: padding 5×10, radius 999, bg `tc.chipBg`, 1px border, 11px weight 700, color `tc.text2`. Hints come from the card payload:
   - `${pos}.` (always present)
   - `${syllableCount} syllables` (compute or server-provide)
   - `starts with "${firstLetter}"`
   Backend addition: extend the `type` card payload with `pos`, `syllables`, `first_letter`. All cheap.
4. **Input row**: padding 16, radius 14, 2px border. `TextInput` placeholder "Type the translation…" — color `tc.text3`. Right side: blinking primary caret while idle, green check glyph when correct.
5. **"I don't know · skip"** below the input — centered, 12px weight 800 letterSpacing 0.4 uppercase color `tc.text3`. Tap → reveals the answer in a yellow callout + the CTA flips to "Got it · Continue" (records as wrong, posts via `srsApi.review(false)`).
6. **Correct callout** (when input matches): green-tinted card with `CORRECT!` eyebrow and `Added to your known words. +5 XP` body. Animate in: opacity 0→1 + translateY 8→0, 220ms.
7. Sticky CTA bar:
   - idle (empty input)        → `Check` disabled, bg `tc.chipBg`, color `tc.text3`, 1px border.
   - typing                    → `Check` enabled (gold).
   - correct                   → `Continue →` (success green) with shadow.
   - revealed (after skip)     → `Got it · Continue →` (red error).

Behaviour:
- Compare `typed.trim().toLowerCase()` to `card.translation` (server should return a `translation_aliases` array for accepted variants — common Russian morphology, accented vs unaccented Latin, etc. Match if `aliases.includes(normalized)`).
- On wrong (with content): shake the input 3× (translateX ±6px, 280ms total via Reanimated `withSequence`). Don't auto-fail — let them try again until they hit Check OR skip.
- On correct: 220ms green-flash transition on the input border (bg + border interpolate), then enable CTA.

### 7.3 Tokens added by quiz screens

Add to `tokens.ts` light + dark + `ThemeColors`:

| Token | Light | Dark | Notes |
|---|---|---|---|
| `wordBoxBg` | `#FAF7EE` | `#0a090d` | Inner word card on quiz screens — slightly off the paper so the word "frames" |
| `successTint` | `rgba(63,139,123,0.14)` | `rgba(76,175,154,0.20)` | Correct flash on choices + input |
| `successBorder` | `rgba(63,139,123,0.55)` | `rgba(76,175,154,0.55)` | Correct choice border |
| `errorBorder` | `rgba(214,106,106,0.55)` | `rgba(229,115,115,0.55)` | Wrong choice border (`errorTint` already exists) |

Light-mode `success` should also be tuned to `#3F8B7B` (a deeper, warmer teal — the current `#4CAF9A` is too saturated on cream).

### 7.4 Files to create

- `apps/mobile/src/components/quiz/QuizHeader.tsx`
- `apps/mobile/src/components/quiz/WordCard.tsx`           (shared by both card types)
- `apps/mobile/src/components/quiz/SynonymMCQCard.tsx`     (renders 4 choices + callout)
- `apps/mobile/src/components/quiz/MCQChoice.tsx`          (the per-choice row)
- `apps/mobile/src/components/quiz/TranslationTypeCard.tsx`(renders hint chips + input + skip)
- `apps/mobile/src/components/quiz/HintChip.tsx`

These compose into the existing `QuizLessonScreen.tsx` and `ReviewScreen.tsx`. The Review screen's current 2×2 grid for `synonym_mcq` should be replaced with `SynonymMCQCard` for visual consistency between the journey/movie quiz and the daily SRS review.

### 7.5 How comprehension % drives quiz word selection

For Claude Code's awareness — your `srsApi.startSession()` and `quizApi.startMovieSession()` already do this server-side, but document the contract here so the client matches:

- **Comprehension %** = `Σ frequency(known words in movie) / Σ frequency(all words in movie)` — frequency-weighted, not flat count. A movie with 4,000 unique words is roughly 85% covered by the top 1,000 most-frequent words, so even an A2 user often reads at 70%+ on most films.
- **Movie quiz word pool** = unknown words in this movie, sorted by descending frequency, capped at `user.cefr + 1 step` (B2 user → up to C1 words). Default lesson size = 5.
- **Daily SRS review pool** = Leitner-scheduled re-tests of any word the user has previously been quizzed on, regardless of movie. Ignores comprehension.
- **`+Δ` after a lesson** = (new known set's freq sum / total freq sum) − previous comprehension. Worth surfacing on `QuizResultScreen`: `Comprehension: 88% → 91%`. This single number is the user's most motivating feedback loop — make it big.

### 7.6 Acceptance criteria (quiz)

- [ ] Both card types render in light AND dark via `useThemeColors()`.
- [ ] No content overlaps the iOS dynamic island in either screen.
- [ ] MCQ: tap on a choice immediately surfaces correct/wrong colour states; correct answer is always highlighted in green even when the user got it wrong.
- [ ] Typing: hint chips render from card payload (`pos`, `syllables`, `first_letter`); "I don't know" reveals the answer and posts as wrong.
- [ ] Typing: input accepts `card.translation_aliases` as well as the canonical translation.
- [ ] CTA states match the matrix in §7.1 / §7.2 — no "Check" button is ever red+ enabled simultaneously.
- [ ] `QuizResultScreen` displays the comprehension `before% → after%` delta for movie-anchored quizzes.
- [ ] `tokens.ts` includes the four new tokens above, plus the tuned light-mode `success`.
- [ ] All 4 quiz states (MCQ idle, MCQ wrong, Typing prompt, Typing correct) match `tabs/quiz.jsx` pixel-for-pixel.

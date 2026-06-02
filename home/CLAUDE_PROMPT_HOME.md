# WordWise — implement the Home / RankedMovieList redesign (Claude Code prompt)

You are re-skinning the **Home screen** of WordWise to match the cinema /
contact-sheet design system already shipped on the **Practice**, **My Movies**
and **Quiz** tabs. This is a **visual redesign only** — the ranked movie feed's
data flow, virtualization, and the movie card itself stay exactly as they are.

Two surfaces are covered here:
- **Mobile** — `apps/mobile/` (React Native + Expo, TypeScript).
- **Web** — the desktop web app (same repo's web target / shared components).

The HTML/JSX mockups you're matching live in this repo at:
- `home/WordWise Home.html` — canvas host (open this to see all artboards)
- `home/home-mobile.jsx` — mobile Home (iOS)
- `home/home-web.jsx` — web Home (desktop)
- `home/data.js` — sample data (reference only; **do NOT port** — keep the real stores/API)

Read those first. Pixel values map 1:1 to React Native (no rem/em conversion).
Cross-reference `tabs/my-movies.jsx`, `tabs/practice.jsx` and `web/shell.jsx` —
they are the canonical source for tokens, type, spacing and the icon set.

---

## 0. The one hard rule — DO NOT touch the movie cards

`apps/mobile/src/components/home/RankedMovieList.tsx` is **kept as-is**:
- `MovieCard` geometry: `CARD_H = 116`, `CARD_GAP = 8`, poster `70×84` radius 8,
  backdrop `ImageBackground` + `rgba(0,0,0,0.52)` overlay.
- The info block (title 15/700 white, `★ rating • CEFR level%` subtext, `N words`).
- The top-right `AddToReelChip` ("+ Add to list" / "✓ Added · tap to remove"),
  its flight animation, the poster lightbox, `FlashList` virtualization, paging
  (`onEndReached`, footer spinner) — **all unchanged**.

Everything else on the screen — the chrome that surrounds the list — is what
changes. If a layout question touches the card, the answer is "leave it."

---

## 1. Design system (already in the repo)

Use `useThemeColors()` / the existing `tokens.ts`. The redesign relies on the
tokens the other tabs already added (`gold`, `goldOnSurface`, `goldDeep`,
`paper`, `chipBg`, `chipBgOn`, `chipTxtOn`, `tabBg`, `tabBorder`, warm light
`background #F4EFE3`, etc.). No new tokens are required for Home.

- **Type**: titles in **Source Serif 4** (600/700); numbers/ratios in
  **JetBrains Mono** (800/900); body in the system sans. Same as other tabs.
- **Icons**: stroked SVG via `react-native-svg`, 1.9–2.2 weight, rounded caps.
  Copy the `Icon` set from `home/home-mobile.jsx`.
- **No emoji anywhere.** The old Home was full of them (🔍 search button,
  🎮 Journey pill, ⭐ level star, 🟢🟡🟠🔴 level dots, 🎬 fallback). Every one
  is replaced by a stroked icon or a CEFR color swatch. The only non-letter
  glyphs allowed are the typographic `★` inside the *movie card's* rating string
  (it's part of the untouched card) and the `↓` sort indicator.

---

## 2. Mobile Home — what changes (top → bottom)

All inside `SafeAreaView edges={['top']}` (62px inset clears the dynamic island).
Add a warm `heroGlow` radial behind the top ~240px (see other tabs).

1. **Header row** (replaces nothing — it's new): eyebrow `YOUR FEED · {level} LEVEL`
   (10px/900, letterSpacing 2, `goldOnSurface`, uppercase) + serif title
   **`Now Showing`** (30px/600, letterSpacing -0.8). Right: a 38px circular
   notification button (`chipBg` + `border`) with a small gold unread dot.

2. **Search bar** (`apps/mobile/src/components/screens/HomeScreen.tsx` search):
   - `paper` field, radius 12, height 48, 1px border that turns `gold` on focus,
     soft `shadowCard`. Leading stroked **search** glyph (was a purple 🔍 button —
     delete that button). Placeholder `Search films, words, or actors…`.
   - Trailing stroked **✕** clear icon when there's a query; blinking gold caret
     on focus.
   - Autocomplete dropdown: `paper`, radius 12, 1px border, big soft shadow.
     Each row = 40×60 poster + serif title + year. Footer `SEE ALL {n} RESULTS`
     in `goldOnSurface`. (Same data wiring as today.)

3. **Ad slot** (`styles.adBanner`): keep the slot but restyle — `chipBg` fill,
   1px **dashed** border, radius 12, centered `ADVERTISEMENT` label (10px/900,
   letterSpacing 2, `text3`). Hidden while the search dropdown is open, as today.

4. **Level + sort controls** (replaces `homeTabToggleWrapper` / `LevelToggle`):
   - **Delete the "🎮 Journey · Soon" pill entirely** — Journey is gone.
   - A label row: `SHOWING AT YOUR LEVEL` (11px/800, letterSpacing 1.4, `text3`,
     uppercase) on the left; on the right a **gold pill** `★ {level} · Your level ▾`
     (`chipBgOn` bg, `chipTxtOn` text, stroked star + chevron icons). Tap → the
     existing level picker, now rendered as a `paper` dropdown where each option
     is a **CEFR color swatch** (8×8 rounded square, `cefrColors[level]`) + label,
     active row tinted gold with a check. (Replaces the 🟢🟡🟠🔴 emoji dots.)
   - **Sort chips** unchanged in behavior (`rating` / `popularity` / `level`),
     restyled to the pill spec: active = `chipBgOn`/`chipTxtOn`, inactive =
     `chipBg`/`text2` + 1px border, padding 7×13, radius 999, 12px/800. Active
     chip shows a trailing `↓`/`↑`.

5. **Ranked feed** — render `RankedMovieList` **exactly as it is now**. Do not
   restyle the cards. (The mockup shows them inline; in the app the existing
   fixed-height virtualized `FlashList` panel stays.)

6. **Today's Word** (`styles.todayCard`): restyle to a `paper` card (radius 14,
   1px border, `shadowCard`). Eyebrow `TODAY'S WORD` (`goldOnSurface`) + `from {movie}`
   on the right. Serif word (30/700) with an italic `{pos}` beside it, definition
   in `text2`, italic example in `text3`. Save button: 1px `gold` outline (or
   `success` outline + tint when saved) with a stroked **bookmark** icon (→ stroked
   **check** when saved). Replaces the old `★ Saved` / `☆ Save this word` glyph text.

7. **Floating Continue pill** (`FloatingContinueButton`): dark glass pill above
   the nav — `rgba(14,12,18,0.86)`, 1px `rgba(255,209,102,0.30)` border, blur.
   40px rounded poster, `CONTINUE · {progress}%` eyebrow in gold, title, and a
   34px gold circle with a stroked **play** triangle (was a `▶` glyph).

8. **Bottom nav** (`GlobalBottomBar`): the new 4-tab bar — `home` / `movies`
   (My Movies) / `practice` / `profile`. Height 78, paddingBottom 18, paddingTop 8,
   `tabBg` fill, `tabBorder` top border. Active icon `gold`, active label `text`;
   inactive `text3`. Stroked icons (`home`, `film`, `spark`, `user`) per the other
   tabs. **No Journey / Rankings tabs.**

### Mobile files to touch
- `apps/mobile/src/components/screens/HomeScreen.tsx` — header, search, ad slot,
  level+sort controls, Today's Word, Continue pill. (Compose the existing
  `RankedMovieList` unchanged.)
- `apps/mobile/src/components/GlobalBottomBar.tsx` — already migrated for the
  two-tab redesign; just confirm Home uses it.
- Extract if helpful: `home/HomeHeader.tsx`, `home/HomeSearchBar.tsx`,
  `home/LevelSortControls.tsx`, `home/TodaysWordCard.tsx`, `home/ContinuePill.tsx`.
- **Untouched:** `home/RankedMovieList.tsx`, `home/SnapPager.tsx`,
  `home/TodayWordCard.tsx` data hooks, `home/filterOptions.ts`.

---

## 3. Web Home — what changes

Match `home/home-web.jsx`. Reuse the shared web shell (`web/shell.jsx` →
`Sidebar`, `TopBar`, `PageHeader`, `WW_TOKENS`). The sidebar is the always-dark
"cinema lobby" with Home active.

Layout inside the content column:
1. **Top bar** — global search (⌘K hint) + theme toggle + notifications (shell).
2. **Page header** — eyebrow `YOUR FEED · {level} LEVEL`, serif title `Now Showing`
   (44/600), subtitle, and a right-aligned **gold level pill** (`★ {level} · Your level ▾`).
3. **Feed column** (flex): a toolbar (`{n} FILMS AT YOUR LEVEL` + `SORT` chips:
   Rating / Popularity / Level %), then the ranked cards as a **single-column,
   full-width** version of the same card treatment:
   - 132px tall, backdrop + left-to-right dark gradient scrim, **serif rank
     numeral** (1, 2, 3 …) on the far left, poster 74×104, title 19/700 white,
     `★ rating • CEFR level%` subtext, mono `N words`, and the same **+ Add to list /
     Added** chip on the right (stroked plus / star icon).
   - This is the desktop expression of the mobile card — keep the same fields and
     the same Add affordance; only the dimensions and the rank numeral differ.
4. **Right rail** (340px): a **Continue** card (poster bg + gradient, gold play
   button, progress bar) above a **Today's Word** card (same content as mobile).

### Web files to touch
- The web Home route/page component (e.g. `HomeWeb` / `pages/Home`). Compose the
  shared `Sidebar` / `TopBar` / `PageHeader`.
- Reuse the web ranked-card component if one exists; otherwise add
  `web/.../RankedFeedRow.tsx` matching the spec above. Keep the data source
  identical to the existing web feed query.

---

## 4. Acceptance criteria

- [ ] `RankedMovieList` / the movie card is **byte-for-byte unchanged** (mobile)
      and the web row carries the same fields + Add affordance.
- [ ] No emoji anywhere on Home (mobile or web). Search 🔍, Journey 🎮, level
      ⭐ + 🟢🟡🟠🔴, fallback 🎬, and the `▶`/`★ Saved` glyphs are all replaced by
      stroked icons or CEFR swatches. (The card's own `★` rating string stays.)
- [ ] Header uses serif `Now Showing` + gold eyebrow; matches the type scale of
      My Movies / Practice headers.
- [ ] Search field, level pill, sort chips, Today's Word, Continue pill all use
      the cinema tokens via `useThemeColors()` — no hard-coded purple
      (`#7C5CBF` / `#9c27b0`) survives on Home.
- [ ] The "Journey · Soon" toggle is gone; bottom nav is the 4-tab redesign bar.
- [ ] Renders correctly in **light and dark**; nothing overlaps the iOS dynamic
      island (`SafeAreaView edges={['top']}`).
- [ ] Web: sidebar shows Home active; feed is single-column with rank numerals;
      right rail has Continue + Today's Word.
- [ ] `npm run typecheck` clean; no `console.warn`/`console.error` on cold start.

When a spacing/color/type question is ambiguous, the files in `home/` (and the
sibling `tabs/` + `web/` templates) have the final word.

# Performance & Race-Condition Audit

Tracking optimization work for slow flows in the WordWise mobile app.
Each section has the diagnosis, the file:line evidence, and a checkbox
for follow-up work.

---

## Flow 1 — Bottom bar tab switches (Home / My Lists / Journey / Rankings / Profile)

### Architecture problem
[apps/mobile/src/core/App.tsx:344-410](apps/mobile/src/core/App.tsx#L344-L410)
uses a single `currentScreen` state with a giant ternary chain
(`currentScreen === 'home' ? <HomeScreen/> : ...`). Every tab switch
**fully unmounts** the previous screen and **remounts** the next from
scratch — local state is lost, every `useEffect(()=>{},[])` mount-effect
re-fires, every API call re-runs.

### Concrete cost on each `Home → My Lists → Home`
HomeScreen unmounts, then on remount fires:
- `srsApi.stats()` ([HomeScreen.tsx:110](apps/mobile/src/components/screens/HomeScreen.tsx#L110))
- `srsApi.todaysWord()` ([HomeScreen.tsx:114](apps/mobile/src/components/screens/HomeScreen.tsx#L114))
- TMDB trending fetch ([HomeScreen.tsx:150](apps/mobile/src/components/screens/HomeScreen.tsx#L150))
- `fetchLevelMovies()` → `/movies/by-cefr` + 15 parallel TMDB
  `/movie/{id}` calls ([HomeScreen.tsx:117-145](apps/mobile/src/components/screens/HomeScreen.tsx#L117-L145))

→ **17+ network requests every time the user comes back to Home**, even
if they were there 3 seconds ago.

### Reference
[React Navigation's docs](https://reactnavigation.org/docs/navigation-lifecycle/)
explicitly say screens stay mounted by default, but this app uses a
manual conditional render so we don't get that for free.

---

## Flow 2 — Movie click → MovieDetailScreen

### Already good
[MovieDetailScreen.tsx:238-264](apps/mobile/src/components/screens/MovieDetailScreen.tsx#L238-L264)
reads `offlineCache.getPayload()` first. If cached → renders instantly,
then revalidates in background. This is the **stale-while-revalidate**
pattern, identical to what TanStack Query does.

### Problem
First-time clicks are still slow because `fetchFromNetwork`
([MovieDetailScreen.tsx:183-221](apps/mobile/src/components/screens/MovieDetailScreen.tsx#L183-L221))
runs **sequentially**:
```
fetchScript → classifyVocabulary → /difficulty → getVocabularyFull
```
Four sequential round-trips. The last two could overlap once the
script_id is known.

No prefetch happens from the home screen before the user clicks. The
backdrop image (~200ms decode) only starts loading when the screen
mounts.

---

## Flow 3 — Movie-detail tab switches (For You / All Levels / CEFR / Words / Expressions)

### Already good
- The transition guard on the unified tab strip (`isTransitioningRef` +
  80/180ms fade) prevents double-fire race conditions.
- Word translations are fetched lazily on row expand, not on tab
  switch ([WordRow.tsx:91-115](apps/mobile/src/components/vocabulary/WordRow.tsx)).

### Problem — full word-list re-render on every tab/level change
- [MovieDetailScreen.tsx:116-137](apps/mobile/src/components/screens/MovieDetailScreen.tsx#L116-L137)
  — `useEffect` on `[activeLevel, viewMode]` runs `fadeAnim` +
  `rowYOffsets.current = {}`, then the JSX re-renders every visible
  row.
- The list is a `<View>` with `.map()`
  ([MovieDetailScreen.tsx:756](apps/mobile/src/components/screens/MovieDetailScreen.tsx#L756))
  — **not a `FlatList`**. Every row re-renders even when only a sibling
  changed.

---

## Action items (priority-ordered)

| # | Change | Effort | Impact | Status |
|---|--------|--------|--------|--------|
| 1 | Prefetch poster + backdrop images on Home/Search row press-in | Low | Removes ~200ms image flash when MovieDetailScreen mounts | ✅ done |
| 2 | Parallelise `/difficulty` + `getVocabularyFull` in `fetchFromNetwork` | Low | ~30% faster first-time movie open | ✅ done |
| 3 | `React.memo` on `WordRow` / `IdiomRow` / `BookmarkRowWrapper` + `useCallback` on handlers | Medium | Expanding one row no longer re-renders all siblings; saving a word only re-renders the affected row | ✅ done |
| 4 | Adopt TanStack Query for `/movies/by-cefr`, `srs.stats`, `todaysWord` | Medium | Bottom-bar tab switches return to Home with instant render + background refresh | ☐ |
| 5 | ~~`Image.prefetch()` backdrops as movie cards scroll into view on Home~~ | — | Merged into item 1 | ✅ done |
| 6 | Stop unmounting top-level tab screens — keep them all mounted, swap visibility | High | Eliminates remount cost entirely (matches what React Navigation does by default) | ☐ |

### Item 1 — implementation detail
- `prefetchMovieImages(movie)` added to `RankedMovieList.tsx` — called from `onPressIn` on each card.
- Same added to `SearchResultsScreen.tsx` `onPressIn`.
- Prefetches `w500` poster + `w780` backdrop. Both downloaded to native disk cache before screen mount.
- File: [`apps/mobile/src/components/home/RankedMovieList.tsx`](apps/mobile/src/components/home/RankedMovieList.tsx)
- File: [`apps/mobile/src/components/screens/SearchResultsScreen.tsx`](apps/mobile/src/components/screens/SearchResultsScreen.tsx)

### Item 3 — implementation detail
- `WordRow`, `IdiomRow`, `BookmarkRowWrapper` all wrapped with `React.memo` (internal component renamed `_X`, exported as `memo(_X)`).
- `handleMarkLearned`, `handleSaveWord`, `handleHideWord`, `recordBookmark` all wrapped with `useCallback` in `MovieDetailScreen`.
- **Before**: expanding any row changed `lastOpenedKey` → parent re-rendered → ALL rows re-rendered. Same for saving a word. With `memo` + stable callbacks, only the affected row(s) re-render.
- File: [`apps/mobile/src/components/vocabulary/WordRow.tsx`](apps/mobile/src/components/vocabulary/WordRow.tsx)
- File: [`apps/mobile/src/components/vocabulary/IdiomRow.tsx`](apps/mobile/src/components/vocabulary/IdiomRow.tsx)
- File: [`apps/mobile/src/components/vocabulary/BookmarkRowWrapper.tsx`](apps/mobile/src/components/vocabulary/BookmarkRowWrapper.tsx)

### Item 2 — implementation detail
- `fetchFromNetwork` in `MovieDetailScreen.tsx` now calls `/difficulty` and `getVocabularyFull` with `Promise.all` instead of sequentially.
- Before: 4 sequential round-trips. After: 3 sequential + 2 parallel at the end.
- File: [`apps/mobile/src/components/screens/MovieDetailScreen.tsx:193-211`](apps/mobile/src/components/screens/MovieDetailScreen.tsx#L193-L211)

---

## References
- [React Navigation lifecycle](https://reactnavigation.org/docs/navigation-lifecycle/)
- [Avoid unmounting screens in React Navigation](https://github.com/react-navigation/react-navigation/issues/8219)
- [TanStack Query prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [TanStack Query in React Native](https://amanhimself.dev/blog/fetching-data-with-tanstack-query-in-react-native/)
- [React Native Image.prefetch](https://jdmunro.net/posts/prefetching-images-in-react-native/)
- [Optimizing a heavy React Native page](https://medium.com/@ronitbhatia98/optimizing-a-heavy-react-native-page-a-gradual-rewrite-journey-c843c020dca9)

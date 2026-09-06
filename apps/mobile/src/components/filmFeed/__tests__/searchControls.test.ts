/**
 * The two controls in the Home search row — the field and the filter button —
 * their shared focus treatment, and the panel each opens.
 *
 * No component-render library in this suite by project rule, so what is pinned
 * here is the geometry and the source contracts — which is where the two real
 * hazards live:
 *
 *   1. The glow is a rotating square read through a rounded rim. Size it by
 *      the field's width instead of its diagonal and the corners go bare a
 *      quarter of the way through every turn — a bug that only shows for a few
 *      frames per rotation and never in a screenshot.
 *   2. The scrim that closes the panel has to be a sibling of the header, not
 *      a child. An absolutely-positioned child that spills past its parent's
 *      bounds does not receive touches on Android, so a scrim parented to the
 *      header works on iOS and silently does nothing on the other half of the
 *      installs.
 */

import fs from 'fs';
import path from 'path';

const HOME = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(HOME, ...p), 'utf8');

/** The square that must cover a w×h rounded rect at every angle. */
const side = (w: number, h: number) => Math.ceil(Math.hypot(w, h));

describe('the two controls behave the same way', () => {
  const bar = () => read('SearchBar.tsx');

  it('both wear the same glow, from the same component', () => {
    // It was SearchFieldGlow until the filter button wanted it too. A
    // component named after one of its two callers is one the next person
    // copies rather than reuses.
    const b = bar();
    expect(b).toMatch(/<FocusGlow active=\{focused\}/);
    expect(b).toMatch(/<FocusGlow active=\{filtersOpen\}/);
  });

  it('both lift by the same amount', () => {
    const b = bar();
    const lifts = b.match(/outputRange: \[1, 1\.022\]/g) ?? [];
    expect(lifts.length).toBe(2);
  });

  it('both tap back on activation', () => {
    const b = bar();
    expect(b).toMatch(/if \(focused && !wasFocused\.current\) feedback\.tap\(\)/);
    expect(b).toMatch(/if \(filtersOpen && !wasFiltersOpen\.current\) feedback\.tap\(\)/);
  });
});

describe('the two panels are never open together', () => {
  const home = () =>
    fs.readFileSync(path.join(HOME, '..', 'screens', 'FilmFeedScreen.tsx'), 'utf8');

  it('focusing the field closes the filter sheet', () => {
    // Enforced on the state, not trusted to the sheet covering the field:
    // that is a fact about geometry, and geometry is what a later layout
    // change quietly revises.
    const h = home();
    const onFocus = h.slice(h.indexOf('onFocus={() => {'), h.indexOf('onFocus={() => {') + 600);
    expect(onFocus).toMatch(/setFiltersOpen\(false\)/);
  });

  it('opening the filter sheet closes the search', () => {
    const h = home();
    const body = h.slice(h.indexOf('const openFilters'), h.indexOf('const openFilters') + 200);
    expect(body).toMatch(/dismissSearch\(\)/);
    expect(body).toMatch(/setFiltersOpen\(true\)/);
  });

  it('the filter button goes through that guard rather than setting state raw', () => {
    expect(home()).toMatch(/onFilterPress=\{openFilters\}/);
  });
});

describe('the rotating glow covers the field at every angle', () => {
  it.each([
    [285, 48],
    [200, 48],
    [420, 48],
  ])('a %ipt × %ipt field is fully covered by its diagonal', (w, h) => {
    const s = side(w, h);
    // The far corner of the field, measured from the centre, must still be
    // inside the rotating square's inscribed circle — that circle is what the
    // corner sees once the square has turned 45°.
    const halfDiagonalOfField = Math.hypot(w / 2, h / 2);
    expect(s / 2).toBeGreaterThanOrEqual(halfDiagonalOfField);
  });

  it('the width alone would NOT cover it — which is the bug this avoids', () => {
    const w = 285;
    const h = 48;
    expect(w / 2).toBeLessThan(Math.hypot(w / 2, h / 2));
  });

  it('sizes the square from both dimensions', () => {
    // `Math.hypot(width, height)`, not `width`. Cheap to get wrong on a later
    // edit, invisible in a still.
    expect(read('FocusGlow.tsx')).toMatch(/Math\.hypot\(box\.width, box\.height\)/);
  });
});

describe('the glow stays out of the way', () => {
  const src = () => read('FocusGlow.tsx');

  it('never takes a touch', () => {
    // It sits over a text input. A decoration that eats a tap is worse than
    // no decoration.
    expect(src()).toMatch(/pointerEvents="none"/);
  });

  it('animates only native-driver properties', () => {
    // Rotation and opacity run off the JS thread; the field is focused at the
    // exact moment the keyboard animation has that thread busiest.
    expect(src()).not.toMatch(/useNativeDriver:\s*false/);
    const drivers = src().match(/useNativeDriver:\s*true/g) ?? [];
    expect(drivers.length).toBeGreaterThanOrEqual(3);
  });

  it('honours reduce motion with a still acknowledgement rather than nothing', () => {
    // The point of the animation is "you focused this". That survives without
    // the spin, so the reduced path fades rather than skipping.
    const s = src();
    expect(s).toMatch(/isReduceMotionEnabled/);
    expect(s).toMatch(/reduceMotion/);
  });

  it('settles by fading, so there is no frame where it switches off', () => {
    // A hard stop reads as a glitch. The glare keeps travelling while it dims.
    expect(src()).toMatch(/Easing\.in\(Easing\.quad\)/);
  });

  it('goes round exactly once, slowly', () => {
    // A second lap turns an acknowledgement into a loading spinner.
    const s = src();
    expect(s).toMatch(/const TURN_MS = 2200/);
    expect(s).toMatch(/toValue: 1,\n\s*duration: TURN_MS,/);
  });

  it('spins linearly, so the glare does not stick at the corners', () => {
    expect(src()).toMatch(/easing: Easing\.linear/);
  });

  it('holds at full strength for most of the lap before fading', () => {
    // Fading from the start leaves it dim by the far side, so the orbit looks
    // lopsided — bright on the way out, invisible on the way back.
    const s = src();
    expect(s).toMatch(/HOLD_FRACTION = 0\.62/);
    expect(s).toMatch(/Animated\.delay\(TURN_MS \* HOLD_FRACTION - FADE_IN_MS\)/);
  });

  it('anchors the highlight at a corner, so there is ONE glare and not two', () => {
    // The bug in the first version: a gradient bright through the *middle*
    // crosses the rim in two opposite places, and reads as two glints chasing
    // each other 180 degrees apart. The first colour stop has to be the bright
    // one, at location 0.
    const s = src();
    const gradient = s.slice(s.indexOf('<LinearGradient'));
    expect(gradient).toMatch(/colors=\{\[tc\.gold,/);
    expect(gradient).toMatch(/locations=\{\[0, 0\.18, 0\.45\]\}/);
  });
});

describe('every point inside the border takes a tap', () => {
  const src = () => read('SearchBar.tsx');

  it('wraps the field in a Pressable that focuses the input', () => {
    // The magnifier, the gap beside it and the padding at the far end all sit
    // inside the border and looked like part of the control, but only the
    // TextInput — a slice of the middle — actually took a tap.
    const s = src();
    expect(s).toMatch(/<Pressable\n\s*style=\{\[s\.field/);
    expect(s).toMatch(/onPress=\{withTap\(focusField\)\}/);
    expect(s).toMatch(/inputRef\.current\?\.focus\(\)/);
    expect(s).toMatch(/ref=\{inputRef\}/);
  });

  it('the wrapper is invisible to screen readers', () => {
    // It is a hit area over a text input, not a button. Announcing it would
    // put a second, meaningless stop in front of the field.
    expect(src()).toMatch(/accessible=\{false\}/);
  });

  it('goes through the feedback module rather than expo-haptics directly', () => {
    // That module is the single owner of both channels and of the policy
    // behind them — the two switches, the silent switch, missing hardware —
    // and a source guard in utils/__tests__/feedback.test.ts fails the build
    // on a second importer. I wrote that second importer before finding it.
    const s = src();
    expect(s).toMatch(/from '\.\.\/\.\.\/utils\/feedback'/);
    expect(s).not.toMatch(/expo-haptics/);
  });

  it('fires the haptic on the focus transition, not from the press handler', () => {
    // Two ways in — a tap on the input and a tap on the padding. Hanging the
    // haptic off onPress would make half the taps feel different.
    const s = src();
    expect(s).toMatch(/if \(focused && !wasFocused\.current\) feedback\.tap\(\)/);
    expect(s).toMatch(/wasFocused\.current = focused/);
  });
});

describe('the panel is the whole of search', () => {
  const bar = () => read('SearchBar.tsx');
  const home = () =>
    fs.readFileSync(path.join(HOME, '..', 'screens', 'FilmFeedScreen.tsx'), 'utf8');
  const app = () => fs.readFileSync(path.join(HOME, '..', '..', 'core', 'App.tsx'), 'utf8');

  it('caps matches at three', () => {
    const h = home();
    expect(h).toMatch(/SUGGESTION_LIMIT = 3/);
    expect(h).toMatch(/results\.slice\(0, SUGGESTION_LIMIT\)/);
  });

  it('has no "see all" footer and nothing to count for one', () => {
    const b = bar();
    expect(b).not.toMatch(/SEE ALL/);
    expect(b).not.toMatch(/allResultsCount/);
    expect(b).not.toMatch(/onSeeAll/);
  });

  it('keeps no full result set in state', () => {
    // `allResults` existed only to feed the count on that footer and the page
    // behind it. Holding every TMDB match for a list of three is dead weight.
    expect(home()).not.toMatch(/allResults/);
  });

  it('the results screen and its route are gone', () => {
    expect(fs.existsSync(path.join(HOME, '..', 'screens', 'SearchResultsScreen.tsx'))).toBe(false);
    const a = app();
    expect(a).not.toMatch(/searchResults/);
    expect(a).not.toMatch(/navigateToSearch/);
    expect(a).not.toMatch(/searchQueryNav/);
  });

  it("'searchResults' is off the Screen union", () => {
    const types = fs.readFileSync(path.join(HOME, '..', '..', 'core', 'types.ts'), 'utf8');
    expect(types).not.toMatch(/'searchResults'/);
  });

  it('the add-to-reel search survived, and is reachable again', () => {
    // The same component served both jobs behind a `mode` prop, so deleting
    // the file would have taken Add Film with it. Nothing navigated to the
    // addToReel route before this — the saved reel's "find films" CTA opened
    // the generic results page with an empty query instead, where tapping a
    // film opened its detail page rather than adding it to the reel you were
    // looking at.
    expect(fs.existsSync(path.join(HOME, '..', 'screens', 'AddFilmSearchScreen.tsx'))).toBe(true);
    expect(app()).toMatch(/onSearchPress=\{navigateToAddToReel\}/);
    expect(app()).toMatch(/setCurrentScreen\('addToReel'\)/);
  });

  it('that screen no longer branches on a mode it cannot be in', () => {
    const screen = fs.readFileSync(
      path.join(HOME, '..', 'screens', 'AddFilmSearchScreen.tsx'), 'utf8',
    );
    expect(screen).not.toMatch(/mode === 'addToReel'/);
    expect(screen).not.toMatch(/onMoviePress/);
  });

  it('the keyboard Search key closes the panel rather than pretending', () => {
    expect(home()).toMatch(/onSubmit=\{dismissSearch\}/);
  });
});

describe('every pressable on Home taps back', () => {
  // CLAUDE.md: a new pressable gets a haptic, wrapped in the JSX so it is
  // visible on the element that owns it and greppable from outside.
  const FILES = [
    ['screens/FilmFeedScreen.tsx', 1],
    ['filmFeed/SearchBar.tsx', 6],
    ['filmFeed/RankedMovieList.tsx', 5],
    ['filmFeed/TodayWordCard.tsx', 4],
    ['filmFeed/FeedFilterSheet.tsx', 5],
  ] as const;

  const componentsDir = path.join(HOME, '..');
  const readRel = (rel: string) => fs.readFileSync(path.join(componentsDir, rel), 'utf8');

  it.each(FILES)('%s wraps its handlers', (rel, count) => {
    const wrapped = readRel(rel).match(/withTap\(/g) ?? [];
    expect(wrapped.length).toBe(count);
  });

  it.each(FILES)('%s leaves no bare onPress behind', (rel) => {
    // Every `onPress=` on these screens should be going through the wrapper.
    // `onPressIn` is deliberately excluded — it fires on touch-down, before
    // there is a decision to acknowledge.
    const src = readRel(rel);
    const bare = (src.match(/onPress=\{(?!withTap)/g) ?? []).length;
    expect(bare).toBe(0);
  });

  it('the wrapper passes arguments and the return value through', () => {
    // The ring handler takes an event and calls stopPropagation on it; a
    // wrapper that swallowed arguments would make the ring open the film.
    const src = fs.readFileSync(
      path.join(componentsDir, '..', 'utils', 'feedback.ts'), 'utf8',
    );
    expect(src).toMatch(/return handler\?\.\(\.\.\.args\)/);
  });

  it('fires the haptic before the handler, never gated on it', () => {
    // Feedback is a garnish on an interaction, not a gate in front of one.
    const src = fs.readFileSync(
      path.join(componentsDir, '..', 'utils', 'feedback.ts'), 'utf8',
    );
    const body = src.slice(src.indexOf('export function withTap'));
    expect(body.indexOf('feedback.tap()')).toBeLessThan(body.indexOf('handler?.('));
  });

  it('the sheet option row is NOT wrapped, because its parent already is', () => {
    // Two wrappers is two buzzes for one press.
    expect(readRel('filmFeed/SheetOptionRow.tsx')).not.toMatch(/withTap/);
    expect(readRel('filmFeed/FeedFilterSheet.tsx')).toMatch(/onPress=\{withTap\(\(\) => onSortPress/);
  });
});

describe('the recently-viewed panel', () => {
  const src = () => read('SearchBar.tsx');

  it('offers three films, not five', () => {
    expect(src()).toMatch(/RECENT_LIMIT = 3/);
    expect(src()).toMatch(/slice\(0, RECENT_LIMIT\)/);
  });

  it('is inset to the field rather than the full row', () => {
    // 72 = the 64pt filter button plus the 8pt gap. The panel used to hang off
    // the end of the control it belongs to.
    expect(src()).toMatch(/dropdownInset/);
    expect(src()).toMatch(/end: 72/);
  });

  it('insets the autocomplete panel identically', () => {
    // Both occupy the same slot. One narrow and one full-width would read as a
    // bug rather than as a distinction.
    const applications = src().match(/s\.dropdownInset/g) ?? [];
    expect(applications.length).toBe(2);
  });

  it('does not inset when there is no filter button to make room for', () => {
    expect(src()).toMatch(/onFilterPress \? s\.dropdownInset : null/);
  });
});

describe('tapping away closes the panel instead of opening a film', () => {
  const src = () => fs.readFileSync(path.join(HOME, '..', 'screens', 'FilmFeedScreen.tsx'), 'utf8');
  const overlay = () => read('SearchDimOverlay.tsx');

  it('the overlay is keyed on focus, not on the panel having rows', () => {
    // Tying it to the panel meant the screen only dimmed once suggestions
    // arrived, so it flickered on as you typed the first character. Focus is
    // what puts the app in search mode.
    expect(src()).toMatch(/<SearchDimOverlay active=\{searchFocused\}/);
  });

  it('the overlay sits over the feed and under the header', () => {
    // feed 0 < overlay 5 < headerStack 10. Any other order either lets the
    // feed take the tap or makes the search field itself untappable.
    expect(overlay()).toMatch(/zIndex:\s*5/);
    expect(src()).toMatch(/headerStack:\s*\{[^}]*zIndex:\s*10/);
  });

  it('never blocks a touch while it is invisible', () => {
    // It stays mounted so it can fade out; an always-live hit area over the
    // whole feed would make the app look frozen.
    expect(overlay()).toMatch(/pointerEvents=\{active \? 'auto' : 'none'\}/);
  });

  it('dims faster on the way out than on the way in', () => {
    // A slow fade on dismissal reads as lag rather than as polish.
    const o = overlay();
    expect(o).toMatch(/FADE_IN_MS = 220/);
    expect(o).toMatch(/FADE_OUT_MS = 160/);
  });

  it('animates opacity only, so it does not fight the keyboard', () => {
    expect(overlay()).not.toMatch(/useNativeDriver:\s*false/);
  });

  it('lightens the dim in light mode', () => {
    // The alpha that reads as "behind something" on a dark ground reads as
    // broken on a pale one.
    expect(overlay()).toMatch(/scheme === 'dark' \? 'rgba\(0,0,0,0\.62\)' : 'rgba\(20,16,10,0\.38\)'/);
  });

  it('shares its vignette with every sheet scrim', () => {
    // A screen that has gone behind something should look the same whichever
    // thing it is behind.
    expect(overlay()).toMatch(/from '\.\.\/common\/Vignette'/);
    const sheet = fs.readFileSync(
      path.join(HOME, '..', 'common', 'BottomSheet.tsx'), 'utf8',
    );
    expect(sheet).toMatch(/<Vignette color=\{SCRIM_EDGE\}/);
  });

  it('the filter button is not reachable while searching', () => {
    // Opening a sheet from under the search panel is never what the tap meant.
    const bar = read('SearchBar.tsx');
    expect(bar).toMatch(/onPress=\{withTap\(focused \? onDismiss \?\? onFilterPress : onFilterPress\)\}/);
    expect(bar).toMatch(/focused && s\.filterBtnDimmed/);
  });

  it('the filter button dismisses rather than doing nothing', () => {
    // A control that looks present and answers to nothing is the dead zone
    // this field just got rid of.
    expect(read('SearchBar.tsx')).toMatch(/onDismiss \?\? onFilterPress/);
  });

  it('dismissing clears focus, the suggestions and the keyboard', () => {
    // Any one of the three left set re-opens the panel on the next render.
    const s = src();
    const body = s.slice(s.indexOf('const dismissSearch'), s.indexOf('const dismissSearch') + 400);
    expect(body).toMatch(/Keyboard\.dismiss\(\)/);
    expect(body).toMatch(/setSearchFocused\(false\)/);
    expect(body).toMatch(/setShowSuggestions\(false\)/);
  });

  it('cancels the pending blur timer so it cannot re-fire after dismissal', () => {
    const s = src();
    const body = s.slice(s.indexOf('const dismissSearch'), s.indexOf('const dismissSearch') + 400);
    expect(body).toMatch(/clearTimeout\(blurTimerRef\.current\)/);
  });
});

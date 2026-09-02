/**
 * Nothing hides behind the bottom bar.
 *
 * `GlobalBottomBar` is an **absolute overlay**, not a flex child: it takes no
 * height from its siblings, so nothing under it loses space to it and every
 * scroller has to reserve the room itself. Miss that and the screen looks
 * completely fine until you scroll to the end — the last rows are drawn, they
 * are simply underneath the bar, and on iOS 26 they are underneath a
 * *translucent* capsule, so they are visible-but-untappable rather than
 * hidden. Settings' Legal links sat there.
 *
 * The number to reserve is `navBarMetrics().reservedHeight`, which every screen
 * gets either as the `bottomOffset` prop App.tsx drills into the four tab
 * screens or from `useBottomBarInset()` directly. Both resolve to the same
 * arithmetic; the hook exists so a screen four levels down doesn't need the
 * prop threaded through every hop.
 *
 * The second thing guarded here is the sheets. They used to inset their whole
 * overlay by the bar's height so as not to cover it — but the bar is rendered
 * *after* every sheet in App.tsx, so it draws on top and stays tappable
 * regardless. All the inset bought was a strip of undimmed live content along
 * the bottom of the screen, framed by the floating capsule.
 */

import fs from 'fs';
import path from 'path';
import { navBarMetrics } from '../navBarMetrics';

const SRC = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Source with comments stripped — this guard is about code, not prose. */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
// 1. The number itself
// ---------------------------------------------------------------------------

describe('the bar reserves more than the capsule it draws', () => {
  it('floating: capsule + the gap under it + the gap above it', () => {
    // A device with a home indicator. The reserved height has to cover the
    // capsule *and* the air on both sides of it, or content stops flush
    // against glass.
    const m = navBarMetrics(34, true);
    expect(m.reservedHeight).toBeGreaterThan(m.barHeight);
    expect(m.reservedHeight).toBe(m.barHeight + m.bottomMargin + 8);
  });

  it('pinned: the bar is flush, so its own height is the whole reservation', () => {
    const m = navBarMetrics(0, false);
    expect(m.reservedHeight).toBe(m.barHeight);
    expect(m.bottomMargin).toBe(0);
  });

  it('is never smaller than the bar on any device shape', () => {
    for (const inset of [0, 20, 34, 44, 59]) {
      for (const floating of [true, false]) {
        const m = navBarMetrics(inset, floating);
        expect(m.reservedHeight).toBeGreaterThanOrEqual(m.barHeight);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every screen reserves it
// ---------------------------------------------------------------------------

describe('every screen under the bar reserves its height', () => {
  /**
   * Screens App.tsx renders inside the authenticated tree. `LoginScreen` is
   * deliberately absent: it renders in the *unauthenticated* branch, where the
   * bar is not in the tree at all, so reserving space for it would leave a
   * hole at the bottom of the sign-in form.
   */
  const files = fs
    .readdirSync(path.join(SRC, 'components'), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? fs
            .readdirSync(path.join(SRC, 'components', e.name))
            .filter((f) => /(Screen|Sheet|Hub)\.tsx$/.test(f))
            .map((f) => path.join('components', e.name, f))
        : /(Screen|Sheet|Hub)\.tsx$/.test(e.name)
          ? [path.join('components', e.name)]
          : [],
    );

  const EXEMPT = new Set([
    // Pre-auth: the bar is not rendered in that branch.
    path.join('components', 'screens', 'LoginScreen.tsx'),
    // Full-screen boot gate, no scroller, nothing to clear.
    path.join('components', 'ui', 'LoadingScreen.tsx'),
  ]);

  const scrollers = files.filter((f) => {
    if (EXEMPT.has(f)) return false;
    return /<(ScrollView|FlatList|FlashList|Animated\.(?:ScrollView|FlatList))\b/.test(code(f));
  });

  it('finds screens to check (guards the guard)', () => {
    expect(scrollers.length).toBeGreaterThan(10);
  });

  it.each(scrollers)('%s reserves room for the bar', (file) => {
    const src = code(file);
    const reserves = /useBottomBarInset|bottomOffset|bottomInset/.test(src);
    expect(reserves).toBe(true);
  });

  it('nobody hard-codes a guess at the bar height', () => {
    // The three that did — `paddingBottom: 120`, `14 + 56 + 24`, `24 + 56 + 80`
    // — were each a different wrong number, and none of them tracked the
    // device's safe-area inset or the pinned/floating split.
    const offenders: string[] = [];
    for (const file of scrollers) {
      const src = code(file);
      if (/paddingBottom:\s*\d+\s*\+\s*\d+/.test(src)) offenders.push(file);
      if (/paddingBottom:\s*(1[0-9]\d|[2-9]\d\d)\b/.test(src)) offenders.push(file);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Sheets cover the whole screen
// ---------------------------------------------------------------------------

describe('sheets dim the whole screen, bar included', () => {
  const SHEETS = [
    path.join('components', 'UserMenuSheet.tsx'),
    path.join('components', 'NotificationsSheet.tsx'),
    path.join('components', 'common', 'BottomSheet.tsx'),
  ];

  it.each(SHEETS)('%s does not inset its overlay by the bar', (file) => {
    // `bottom: bottomOffset` on the overlay container is the bug: it left the
    // strip behind the floating capsule undimmed and live.
    expect(code(file)).not.toMatch(/bottom:\s*bottomOffset/);
  });

  it.each(SHEETS)('%s still keeps its own rows clear of the bar', (file) => {
    // The offset does not disappear — it moves inside, as padding.
    expect(code(file)).toMatch(/paddingBottom:\s*SHEET_PAD_BOTTOM \+ bottomOffset/);
  });

  it.each(SHEETS)('%s does not add the offset to its hidden position twice', (file) => {
    // The sheet hides by translating past its own measured height. Now that
    // the bar's height is *inside* that measurement, adding it again would
    // overshoot and make the sheet travel further than it needs to.
    expect(code(file)).not.toMatch(/layout\.height \+ bottomOffset/);
  });
});

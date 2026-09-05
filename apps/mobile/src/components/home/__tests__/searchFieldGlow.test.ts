/**
 * The search field's focus treatment, and the panel it opens.
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
    expect(read('SearchFieldGlow.tsx')).toMatch(/Math\.hypot\(box\.width, box\.height\)/);
  });
});

describe('the glow stays out of the way', () => {
  const src = () => read('SearchFieldGlow.tsx');

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
  const src = () => read('HomeSearchBar.tsx');

  it('wraps the field in a Pressable that focuses the input', () => {
    // The magnifier, the gap beside it and the padding at the far end all sit
    // inside the border and looked like part of the control, but only the
    // TextInput — a slice of the middle — actually took a tap.
    const s = src();
    expect(s).toMatch(/<Pressable\n\s*style=\{\[s\.field/);
    expect(s).toMatch(/onPress=\{focusField\}/);
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

describe('the recently-viewed panel', () => {
  const src = () => read('HomeSearchBar.tsx');

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
  const src = () => fs.readFileSync(path.join(HOME, '..', 'screens', 'HomeScreen.tsx'), 'utf8');
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
    expect(overlay()).toMatch(/scheme === 'dark' \? 'rgba\(0,0,0,0\.46\)' : /);
  });

  it('the filter button is not reachable while searching', () => {
    // Opening a sheet from under the search panel is never what the tap meant.
    const bar = read('HomeSearchBar.tsx');
    expect(bar).toMatch(/onPress=\{focused \? onDismiss \?\? onFilterPress : onFilterPress\}/);
    expect(bar).toMatch(/focused && s\.filterBtnDimmed/);
  });

  it('the filter button dismisses rather than doing nothing', () => {
    // A control that looks present and answers to nothing is the dead zone
    // this field just got rid of.
    expect(read('HomeSearchBar.tsx')).toMatch(/onDismiss \?\? onFilterPress/);
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

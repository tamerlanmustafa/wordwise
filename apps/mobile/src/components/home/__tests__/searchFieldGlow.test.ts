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

  it('renders a scrim while the panel is open', () => {
    expect(src()).toMatch(/searchScrim/);
    expect(src()).toMatch(/dropdownOpen \? \(/);
  });

  it('the scrim sits over the feed and under the header', () => {
    // feed 0 < scrim 5 < headerStack 10. Any other order either lets the feed
    // take the tap or makes the search field itself untappable.
    const styles = src();
    expect(styles).toMatch(/searchScrim:\s*\{[^}]*zIndex:\s*5/);
    expect(styles).toMatch(/headerStack:\s*\{[^}]*zIndex:\s*10/);
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

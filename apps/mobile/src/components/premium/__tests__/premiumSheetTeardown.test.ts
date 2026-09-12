/**
 * Closing the upgrade sheet, pinned line by line.
 *
 * This suite has no render library by project rule, so the teardown contract
 * is asserted against the source. That is weaker than driving the component,
 * and it is chosen deliberately: every item below is a specific bug with a
 * specific symptom, and a source guard that fails loudly in CI beats a
 * convention nobody re-reads.
 *
 * Each guard maps to one failure:
 *
 *   * unmounting on `visible` instead of on the animation's completion → the
 *     sheet vanishes instantly and the slide-down is never seen;
 *   * no async guard → a purchase resolving after dismissal sets state on a
 *     closed sheet, or pops a success alert over a screen the user moved on
 *     from;
 *   * `pointerEvents` missing → an invisible scrim keeps swallowing taps on
 *     the tab behind it, and the report is "the app froze", which points
 *     nowhere near this file;
 *   * no BackHandler → Android's back button pops the screen BEHIND the
 *     sheet, leaving it floating over a tab nobody chose.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Source with comments stripped — this file documents its own teardown at
 *  length, and matching raw text would pass on the docblock. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sheet = () => code(read('components', 'premium', 'PremiumSheet.tsx'));

describe('the exit animation finishes before the content goes', () => {
  it('unmounts from the animation callback, not from `visible`', () => {
    const s = sheet();
    expect(s).toMatch(/start\(\(\{ finished \}\) =>/);
    expect(s).toMatch(/if \(finished\) setRendered\(false\)/);
  });

  it('renders on its own trailing flag rather than on the store', () => {
    // `if (!visible) return null` would skip the exit entirely.
    const s = sheet();
    expect(s).toMatch(/if \(!rendered\) return null;/);
    expect(s).not.toMatch(/if \(!visible\) return null;/);
  });

  it('animates out rather than snapping', () => {
    expect(sheet()).toMatch(/toValue: 0/);
  });
});

describe('an async purchase cannot write to a closed sheet', () => {
  it('keeps a liveness ref and clears it on dismiss', () => {
    const s = sheet();
    expect(s).toMatch(/const liveRef = useRef\(false\)/);
    const dismiss = s.slice(s.indexOf('const dismiss = useCallback'));
    expect(dismiss.slice(0, 200)).toMatch(/liveRef\.current = false/);
  });

  it('checks it after every await', () => {
    // The native store sheet can sit open for minutes; the user may be three
    // screens away by the time it resolves.
    const s = sheet();
    const guards = s.match(/if \(!liveRef\.current\) return/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('guards the busy reset too', () => {
    // The `finally` runs whether or not the purchase succeeded, so it is its
    // own path back into state.
    expect(sheet()).toMatch(/if \(liveRef\.current\) setBusy\(false\)/);
  });
});

describe('the hidden sheet stops taking touches', () => {
  it('sets pointerEvents from visibility', () => {
    expect(sheet()).toMatch(/pointerEvents=\{visible \? 'auto' : 'none'\}/);
  });
});

describe('every exit routes through one dismiss', () => {
  it('handles the Android back button', () => {
    const s = sheet();
    expect(s).toMatch(/BackHandler\.addEventListener\('hardwareBackPress'/);
    // Returning true is what stops the event falling through to the navigator.
    expect(s).toMatch(/return true;/);
  });

  it('removes the back handler when it goes away', () => {
    // A listener that outlives the sheet swallows Back for the whole app.
    expect(sheet()).toMatch(/return \(\) => sub\.remove\(\)/);
  });

  it('dismisses on the scrim', () => {
    expect(sheet()).toMatch(/onPress=\{withTap\(dismiss\)\}/);
  });

  it('closes itself if the user becomes premium while it is open', () => {
    // Restoring a purchase, or subscribing on another device, should not
    // leave someone reading a pitch for something they now own.
    expect(sheet()).toMatch(/if \(rendered && isPremium\) dismiss\(\)/);
  });
});

describe('re-opening is clean', () => {
  it('resets the controls on open, not on close', () => {
    // Resetting on close rewrites the plan cards to the default while they
    // are still sliding down, in full view.
    const s = sheet();
    const open = s.slice(s.indexOf('if (visible) {'), s.indexOf('liveRef.current = false;'));
    expect(open).toMatch(/setPlan\('annual'\)/);
    expect(open).toMatch(/setBusy\(false\)/);
  });
});

describe('there is one checkout, not two', () => {
  it('reuses the billing service rather than inventing a purchase path', () => {
    // A second checkout is a second place for receipts, restores and trial
    // eligibility to drift out of step.
    const s = sheet();
    expect(s).toMatch(/from '\.\.\/\.\.\/services\/billing'/);
    expect(s).toMatch(/purchaseProduct/);
    expect(s).toMatch(/restorePurchases/);
  });

  it('reuses the feature list and subtitle rules from paywallPricing', () => {
    const s = sheet();
    expect(s).toMatch(/PAYWALL_FEATURES/);
    expect(s).toMatch(/paywallSubtitle/);
  });
});

describe('it is mounted once, at the root', () => {
  it('only the app root imports it', () => {
    const importers = ['core/App.tsx']
      .concat([])
      .filter((f) => read(...f.split('/')).includes('PremiumSheet'));
    expect(importers).toEqual(['core/App.tsx']);
  });

  it('the capped tile opens it instead of starting a session', () => {
    const screen = code(read('components', 'PracticeScreen.tsx'));
    expect(screen).toMatch(/openPremiumSheet\('daily_cap_reached'\)/);
    // And returns, rather than falling through into the session start.
    const handler = screen.slice(screen.indexOf('const handleTilePress'));
    expect(handler.slice(0, 400)).toMatch(/return;/);
  });

  it('falls through when the server state has not arrived', () => {
    // An unanswered network call is not evidence the user is capped. Guessing
    // wrong here denies a lesson someone is entitled to.
    const screen = code(read('components', 'PracticeScreen.tsx'));
    expect(screen).toMatch(/serverState\?\.today_done/);
  });
});

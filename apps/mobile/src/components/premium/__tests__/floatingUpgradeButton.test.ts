/**
 * The floating "Upgrade to Plus" button.
 *
 * Built before it is placed (2026-09-15) — the tabs that will carry it are
 * still to be chosen — so these guard what it has to be wherever it lands.
 * Source guards, because this suite has no render library by project rule.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Comments stripped: the docblock names things the code must not do. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const button = () => code(read('components', 'premium', 'FloatingUpgradeButton.tsx'));

describe('the floating upgrade button', () => {
  it('opens the one upgrade sheet rather than navigating to a screen', () => {
    // A sheet leaves the tab behind it intact; a pushed paywall would lose
    // the reader's place (see premiumSheetStore).
    const b = button();
    expect(b).toMatch(/openPremiumSheet\(reason\)/);
    expect(b).not.toMatch(/PaywallScreen|navigate/i);
  });

  it('shows only to accounts known to be free', () => {
    // `useIsPremium` fails closed — a tier the server has not reported yet
    // counts as free. Right for a gate, wrong for a pitch: every cold start
    // would ask a paying member to pay until /auth/me answered.
    const b = button();
    expect(b).toMatch(/const entitlements = useEntitlements\(\);/);
    expect(b).toMatch(/if \(!entitlements \|\| entitlements\.is_premium\) return null;/);
    expect(b).not.toMatch(/useIsPremium/);
  });

  it('keeps an unknown tier distinct from free in the hook it relies on', () => {
    // The guard above is only as good as this: if useEntitlements ever
    // defaulted to the free entitlements, the button would pitch on unknown.
    const store = code(read('stores', 'entitlementsStore.ts'));
    expect(store).toMatch(
      /export function useEntitlements\(\): Entitlements \| undefined \{[\s\S]*?if \(!user\?\.entitlements\) return undefined;/,
    );
  });

  it('floats above the tab bar by the bar’s own reserved height', () => {
    // The bar is an absolute overlay on every screen; a hard-coded bottom would
    // miss the safe area and the floating/pinned split.
    const b = button();
    expect(b).toMatch(/const barInset = useBottomBarInset\(\);/);
    expect(b).toMatch(/bottom: barInset \+ UPGRADE_FAB_GAP/);
    expect(b).toMatch(/position: 'absolute'/);
  });

  it('taps back exactly once', () => {
    // PressablePill fires no haptic of its own, so the press is wrapped here,
    // once. PressableScale would buzz a second time.
    const b = button();
    expect(b).toMatch(/<PressablePill/);
    expect(b.match(/withTap\(/g) ?? []).toHaveLength(1);
    expect(b).not.toMatch(/PressableScale/);
  });

  it('never puts elevation on the pill', () => {
    // On Android, elevation on the edge layer draws the edge over the face.
    expect(button()).not.toMatch(/elevation/);
  });

  it('shows and speaks the translated label', () => {
    const b = button();
    expect(b).toMatch(/const label = t\('settings:upgradeToPlus'\);/);
    expect(b).toMatch(/accessibilityLabel=\{label\}/);
    expect(b).toMatch(/accessibilityRole="button"/);
  });

  it('leaves the corner around the pill tappable', () => {
    expect(button()).toMatch(/pointerEvents="box-none"/);
  });
});

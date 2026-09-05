/**
 * The account area after Profile stopped being a bottom sheet.
 *
 * The sheet was the only destination in the app that was not a screen, and it
 * charged for that everywhere: navParents needed a `PROFILE_SHEET` sentinel
 * because an overlay has no place in a `Screen` union, Back from Settings had
 * to re-open an overlay rather than pop a screen, the tab handler had to
 * special-case Profile so switching tabs collapsed it, and it kept a ref
 * remembering which tab it had opened over so Back could put you back there.
 *
 * All of that is deleted rather than disabled, so these guards are about the
 * shape not growing back — and about the four hub destinations continuing to
 * exist, since a hub row that navigates nowhere renders perfectly happily.
 */

import fs from 'fs';
import path from 'path';
import { PARENT_OF } from '../../core/navParents';
import type { Screen } from '../../core/types';

const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('Profile is a screen, not an overlay', () => {
  it('the sheet and its row registry are gone', () => {
    expect(fs.existsSync(path.join(SRC, 'components', 'UserMenuSheet.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'components', 'userMenuRows.ts'))).toBe(false);
  });

  it('nothing still imports them', () => {
    const app = read('core', 'App.tsx');
    expect(app).not.toMatch(/UserMenuSheet|userMenuRows/);
  });

  it('App keeps no sheet visibility flag or host-tab memory', () => {
    // `showUserSheet` and `rootTabForSheet` only existed because the overlay
    // had to remember which tab it was floating over. A screen has neither problem.
    const app = read('core', 'App.tsx');
    expect(app).not.toMatch(/showUserSheet/);
    expect(app).not.toMatch(/rootTabForSheet/);
  });

  it('navParents no longer needs a sentinel parent', () => {
    expect(read('core', 'navParents.ts')).not.toMatch(/PROFILE_SHEET/);
  });
});

describe('the hub reaches all four destinations', () => {
  const hub = () => read('components', 'screens', 'ProfileScreen.tsx');

  it.each([
    'onNavigateToSettings',
    'onNavigateToNotifications',
    'onNavigateToAccount',
    'onNavigateToLegal',
  ])('%s is wired to a row', (prop) => {
    // Each appears twice — once in the props, once on a row. A prop that is
    // declared and never used is exactly how a dead row ships.
    const occurrences = hub().split(prop).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('every destination is a real screen with Profile as its parent', () => {
    const destinations: Screen[] = ['settings', 'notificationSettings', 'account', 'legal'];
    for (const screen of destinations) {
      expect(PARENT_OF[screen]).toBe('profile');
    }
  });

  it('Profile itself is parentless, like every other tab root', () => {
    expect(PARENT_OF.profile).toBeUndefined();
  });
});

describe('what moved off Settings stayed reachable', () => {
  it('subscription lives on Account', () => {
    const account = read('components', 'screens', 'AccountScreen.tsx');
    expect(account).toMatch(/settings:familyPlan/);
    expect(account).toMatch(/settings:restorePurchases/);
  });

  it('account deletion lives on Account and nowhere else', () => {
    // App Store 5.1.1(v) requires it in-app. It has moved twice now — sheet →
    // Settings → Account — and each move is a chance to lose it.
    const account = read('components', 'screens', 'AccountScreen.tsx');
    expect(account).toMatch(/deleteAccount/);
    expect(read('components', 'screens', 'SettingsScreen.tsx')).not.toMatch(/deleteAccount/);
  });

  it('both legal documents live on Legal', () => {
    const legal = read('components', 'screens', 'LegalScreen.tsx');
    expect(legal).toMatch(/settings:privacyPolicy/);
    expect(legal).toMatch(/settings:termsOfService/);
  });

  it('Settings keeps only what you set', () => {
    const settings = read('components', 'screens', 'SettingsScreen.tsx');
    expect(settings).toMatch(/settings:languagePreferences/);
    // The sections that moved out must not have been left behind as copies.
    expect(settings).not.toMatch(/settings:subscription/);
    expect(settings).not.toMatch(/settings:legal/);
  });
});

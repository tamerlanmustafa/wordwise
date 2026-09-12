/**
 * The arming endpoints must have a caller.
 *
 * `POST /daily/freeze/equip` and `/unequip` shipped, `api.ts` wrapped them,
 * the server stopped spending unarmed freezes — and for one release nothing in
 * the app called either one. The mechanic was complete, tested, deployed and
 * unreachable: every freeze a user owned sat unarmed, which under the new
 * consume rule meant none of them could ever be spent. A backend feature with
 * no entry point is indistinguishable from a broken one.
 *
 * These are source guards because the suite has no render library. They pin
 * the chain — readout is a button, button opens the sheet, sheet calls the
 * API — at each link, since breaking any one of them restores the silence.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Source with comments stripped — these files discuss the API at length in
 *  prose, and matching raw text would pass on a docblock. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sheet = () => code(read('components', 'practice', 'FreezeSheet.tsx'));
const panel = () => code(read('components', 'practice', 'StreakWeek.tsx'));
const screen = () => code(read('components', 'PracticeScreen.tsx'));

describe('the sheet actually talks to the endpoints', () => {
  it('calls both of them', () => {
    expect(sheet()).toMatch(/dailyApi\.equipFreeze\(\)/);
    expect(sheet()).toMatch(/dailyApi\.unequipFreeze\(\)/);
  });

  it('takes the counts from the response rather than adjusting its own', () => {
    // The cap is the server's and another device may have armed one. A local
    // `equipped + 1` would disagree with the server the first time either of
    // those mattered.
    expect(sheet()).toMatch(/onChange\(next\)/);
    expect(sheet()).not.toMatch(/equipped \+ 1|equipped - 1/);
  });

  it('reports a declined tap instead of swallowing it', () => {
    expect(sheet()).toMatch(/if \(!next\.changed\)/);
    expect(sheet()).toMatch(/showToast/);
  });
});

describe('there is a way in', () => {
  it('the freeze readout is a pressable, not a label', () => {
    expect(panel()).toMatch(/onPress=\{withTap\(onPressFreezes\)\}/);
  });

  it('the readout carries a haptic exactly once', () => {
    // House rule: wrapped in the JSX, at one level only. Two wrappers on one
    // press is two buzzes.
    const wraps = panel().match(/withTap\(/g) ?? [];
    expect(wraps).toHaveLength(1);
  });

  it('the screen mounts the sheet and opens it from that readout', () => {
    const s = screen();
    expect(s).toMatch(/<FreezeSheet/);
    expect(s).toMatch(/onPressFreezes=\{openFreezeSheet\}/);
  });

  it('the sheet is fed the same counts the panel shows', () => {
    // Two sources for one number is how a sheet ends up disagreeing with the
    // header that opened it.
    const s = screen();
    expect(s).toMatch(/held=\{serverState\?\.freezes_held \?\? 0\}/);
    expect(s).toMatch(/equipped=\{serverState\?\.freezes_equipped \?\? 0\}/);
  });
});

describe('the copy exists in every language', () => {
  it('has the sheet strings in all six locales', () => {
    const dir = path.join(SRC, 'i18n', 'locales');
    const langs = fs.readdirSync(dir).filter((d) =>
      fs.existsSync(path.join(dir, d, 'practice.json')),
    );
    expect(langs).toHaveLength(6);
    for (const lang of langs) {
      const ns = JSON.parse(read('i18n', 'locales', lang, 'practice.json'));
      // The sentence explaining that arming happens in advance is the whole
      // reason a user accepts an extra tap before something that used to be
      // automatic. Missing in one language, that language gets a bare control.
      for (const key of ['title', 'body', 'armed', 'arm', 'disarm', 'empty', 'openA11y']) {
        expect(typeof ns.freezeSheet?.[key]).toBe('string');
        expect((ns.freezeSheet[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });
});

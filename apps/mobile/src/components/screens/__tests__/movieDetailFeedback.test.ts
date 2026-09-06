/**
 * Every pressable on MovieDetail taps back.
 *
 * CLAUDE.md's rule is that a new pressable gets a haptic, wrapped in the JSX
 * so a reviewer sees the feedback on the element that owns it. The rule is
 * only worth anything if it is checked, because the failure is silent: a
 * button with no haptic looks completely correct in the diff and in a
 * screenshot, and only the person holding the phone can tell.
 *
 * This screen is the one with the most pressables, and they arrived over many
 * sessions — the back chip, the level chips, the view toggles, the sort
 * cluster, the retry, the poster-zoom backdrop, the undo, the quiz pill.
 */

import fs from 'fs';
import path from 'path';

const SCREEN = path.join(__dirname, '..', 'MovieDetailScreen.tsx');
const src = () => fs.readFileSync(SCREEN, 'utf8');

describe('MovieDetail feedback', () => {
  it('wraps every onPress', () => {
    // Counting rather than listing: a new button that forgets the wrapper is
    // exactly what this is for, and a hard-coded list of the ones that exist
    // today would pass while the new one buzzes at nobody.
    const all = src().match(/onPress=\{/g) ?? [];
    const wrapped = src().match(/onPress=\{withTap\(/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(wrapped.length).toBe(all.length);
  });

  it('goes through the feedback module, never the native one', () => {
    // `utils/feedback` owns both channels and the policy behind them — the
    // user's two switches, missing hardware, the silent switch — and a source
    // guard elsewhere fails the build on a second importer of the native
    // module. It scans source text, so the module must not be named here even
    // in prose.
    const s = src();
    expect(s).toMatch(/import \{ withTap \} from '\.\.\/\.\.\/utils\/feedback'/);
    expect(s).not.toMatch(/expo-hapt/);
  });

  it('wraps in the JSX rather than inside the handlers', () => {
    // Two reasons, both from CLAUDE.md: a reviewer looking at a new button can
    // see the feedback on the element that owns it, and a call buried on line
    // four of a handler cannot be grepped for — which is what makes the count
    // above meaningful.
    expect(src()).not.toMatch(/feedback\.tap\(\)/);
  });
});

/**
 * Every pressable reachable from MovieDetail taps back.
 *
 * CLAUDE.md's rule is that a new pressable gets a haptic, wrapped in the JSX
 * so a reviewer sees the feedback on the element that owns it. The rule is
 * only worth anything if it is checked, because the failure is silent: a
 * button with no haptic looks completely correct in the diff and in a
 * screenshot, and only the person holding the phone can tell.
 *
 * ## Why this is a list of files and not one file
 *
 * The first version of this test covered `MovieDetailScreen.tsx` alone and
 * passed while the card tap, "Know it", "Next", the heart, the speaker and
 * the report link were all still silent — because a screen is not a file. The
 * buttons a user thinks of as "on this screen" live in the components it
 * renders, and a guard scoped to the container measures the wrong thing while
 * looking thorough.
 *
 * So the unit here is the *reachable subtree*. A new component rendered by
 * this screen has to be added below; that is the intended friction, and it is
 * cheaper than shipping another silent button.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');

/** Everything a user can press without leaving MovieDetail. */
const SUBTREE = [
  ['screens', 'MovieDetailScreen.tsx'],
  ['screens', 'MovieDetailHero.tsx'],
  ['vocabulary', 'WordCardDeck.tsx'],
  ['vocabulary', 'VocabRow.tsx'],
  ['ReportDialog.tsx'],
];

const read = (p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const label = (p: string[]) => p.join('/');

describe('MovieDetail feedback', () => {
  it.each(SUBTREE.map((p) => [label(p), p] as const))('%s wraps every onPress', (_name, p) => {
    // Counting rather than listing: a new button that forgets the wrapper is
    // exactly what this is for, and a hard-coded list of the ones that exist
    // today would pass while the new one buzzes at nobody.
    const s = read(p);
    const all = s.match(/onPress=\{/g) ?? [];
    const wrapped = s.match(/onPress=\{withTap\(/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(wrapped.length).toBe(all.length);
  });

  it.each(SUBTREE.map((p) => [label(p), p] as const))(
    '%s goes through the feedback module, never the native one',
    (_name, p) => {
      // `utils/feedback` owns both channels and the policy behind them — the
      // user's two switches, missing hardware, the silent switch — and a
      // source guard elsewhere fails the build on a second importer of the
      // native module. It scans source text, so that module must not be named
      // here even in prose.
      const s = read(p);
      expect(s).toMatch(/import \{ withTap \} from '[^']*utils\/feedback'/);
      expect(s).not.toMatch(/expo-hapt/);
    },
  );

  it.each(SUBTREE.map((p) => [label(p), p] as const))(
    '%s wraps in the JSX rather than inside the handlers',
    (_name, p) => {
      // Two reasons, both from CLAUDE.md: a reviewer looking at a new button
      // can see the feedback on the element that owns it, and a call buried on
      // line four of a handler cannot be grepped for — which is what makes the
      // count above meaningful.
      expect(read(p)).not.toMatch(/feedback\.tap\(\)/);
    },
  );

  it('does not double-wrap the deck buttons the screen also owns', () => {
    // Two wrappers is two buzzes for one press. The deck's own buttons are
    // wrapped here, so the callbacks the screen hands down must stay bare —
    // `onMarkLearned`, `onSave` and friends are invoked inside handlers the
    // deck already wrapped.
    const screen = read(['screens', 'MovieDetailScreen.tsx']);
    expect(screen).not.toMatch(/onMarkLearned=\{withTap\(/);
    expect(screen).not.toMatch(/onSave=\{withTap\(/);
  });
});

describe('"Knew it" reports itself the way the rest of the app does', () => {
  const screen = () => read(['screens', 'MovieDetailScreen.tsx']);

  it('uses the global toast, not a bar of its own', () => {
    // This screen grew its own undo bar — its own view, styles and dismissal —
    // so the app told you what it had just done in two different places
    // depending on which screen you were standing on. The film feed's "Seen
    // it" and "Not interested" already had the shape.
    const s = screen();
    expect(s).toMatch(/import \{ showToast \} from '\.\.\/\.\.\/stores\/toastStore'/);
    expect(s).toMatch(/actionLabel: t\('movies:detail\.undo'\)/);
    expect(s).not.toMatch(/undoToastInner|undoToastAction/);
  });

  it('offers the Undo for exactly as long as it works', () => {
    // The toast's default dwell is 3.6s and the deferred write lands at 5s.
    // Held apart, the gap between them is a window with nothing on screen to
    // press and still time to press it.
    const s = screen();
    expect(s).toMatch(/const LEARNED_COMMIT_MS = 5000/);
    expect(s).toMatch(/duration: LEARNED_COMMIT_MS/);
    expect(s).toMatch(/\}, LEARNED_COMMIT_MS\)/);
    expect(s).not.toMatch(/\}, 5000\)/);
  });

  it('says what happened, rather than that something was hidden', () => {
    // The old bar read `"word" hidden`, which described the row disappearing
    // from a list view this screen no longer shows.
    const en = JSON.parse(
      fs.readFileSync(
        // SRC is src/components; the locales live a level above it.
        path.join(SRC, '..', 'i18n', 'locales', 'en', 'vocabulary.json'),
        'utf8',
      ),
    );
    expect(en.deck.markedKnown).toMatch(/known/i);
    expect(screen()).toMatch(/t\('vocabulary:deck\.markedKnown', \{ word \}\)/);
  });
});

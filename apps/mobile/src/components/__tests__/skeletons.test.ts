/**
 * Skeletons: the ones we have are placeholders, and they are the right size.
 *
 * A loading placeholder is the one component that cannot fail loudly. It
 * renders, it animates, it looks deliberate — and if it is the wrong shape the
 * only symptom is the screen re-laying-out at the moment the data lands, which
 * everyone reads as jank rather than as a placeholder that stopped matching
 * its target. Two of them had been wrong for months:
 *
 *   • `FeedSkeleton` drew a 64x96 portrait poster with two text lines beside
 *     it. That was the home feed's row layout *before* the card redesign made
 *     every row a 116pt full-width backdrop tile.
 *   • ReviewScreen's inline bars drew **three** answer rows where every deck
 *     has four, at 52pt against a 56pt tap target, radius 12 against 14, under
 *     a 6pt progress bar where the header's is 4pt.
 *
 * The structural fix is that the numbers now live with the real component and
 * both sides read them. These tests hold that: the geometry is shared, no
 * skeleton restates it, and no screen has gone back to standing a spinner in
 * for content.
 */

import fs from 'fs';
import path from 'path';
import {
  CARD_GAP,
  CARD_H,
  CARD_RADIUS,
  ITEM_H,
  RING_SIZE,
} from '../home/cardVisuals';
import {
  MCQ_CHOICE_COUNT,
  MCQ_CHOICE_GAP,
  MCQ_CHOICE_MIN_H,
  MCQ_CHOICE_RADIUS,
  WORD_CARD_H,
  WORD_CARD_RADIUS,
} from '../quiz/mcqLogic';

const SRC = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** Source with comments stripped — these guards look for code, not prose. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
// 1. Geometry is shared, not copied
// ---------------------------------------------------------------------------

describe('the home card and its skeleton read one set of numbers', () => {
  it('exposes the card geometry from cardVisuals', () => {
    expect(CARD_H).toBe(116);
    expect(CARD_GAP).toBe(8);
    expect(ITEM_H).toBe(CARD_H + CARD_GAP);
    expect(CARD_RADIUS).toBe(14);
  });

  it('the real card imports them rather than declaring its own', () => {
    const src = code('components/home/RankedMovieList.tsx');
    expect(src).toMatch(/import \{[\s\S]*?CARD_H[\s\S]*?\} from '\.\/cardVisuals'/);
    expect(src).not.toMatch(/const\s+CARD_H\s*=/);
    expect(src).not.toMatch(/const\s+CARD_GAP\s*=/);
  });

  it('the skeleton imports them too', () => {
    const src = code('components/common/FeedSkeleton.tsx');
    expect(src).toMatch(/CARD_H/);
    expect(src).toMatch(/CARD_RADIUS/);
    expect(src).toMatch(/from '\.\.\/home\/cardVisuals'/);
  });

  it('the skeleton hard-codes no size of its own', () => {
    // The specific regression: `width={64} height={96}` — a portrait poster
    // from the pre-redesign layout, which nothing on the feed has looked like
    // for months.
    const src = code('components/common/FeedSkeleton.tsx');
    expect(src).not.toMatch(/width=\{64\}/);
    expect(src).not.toMatch(/height=\{96\}/);
    expect(src).not.toMatch(/height=\{116\}/); // even the right number, restated
  });

  it('draws the ring at the ring size', () => {
    expect(code('components/common/FeedSkeleton.tsx')).toMatch(/RING_SIZE/);
    expect(RING_SIZE).toBe(44);
  });
});

describe('the quiz card and its skeleton read one set of numbers', () => {
  it('every deck has four choices', () => {
    expect(MCQ_CHOICE_COUNT).toBe(4);
  });

  it('the choice row height is the tap target, not a look', () => {
    // 44pt is Apple's floor; the row is 56 so a wrapped gloss still clears it.
    expect(MCQ_CHOICE_MIN_H).toBeGreaterThanOrEqual(44);
    expect(MCQ_CHOICE_MIN_H).toBe(56);
    expect(MCQ_CHOICE_RADIUS).toBe(14);
    expect(MCQ_CHOICE_GAP).toBe(10);
  });

  it('the real choice row reads them', () => {
    const src = code('components/quiz/MCQChoice.tsx');
    expect(src).toMatch(/minHeight: MCQ_CHOICE_MIN_H/);
    expect(src).toMatch(/borderRadius: MCQ_CHOICE_RADIUS/);
  });

  it('the skeleton reads them and restates nothing', () => {
    const src = code('components/quiz/QuizCardSkeleton.tsx');
    expect(src).toMatch(/MCQ_CHOICE_COUNT/);
    expect(src).toMatch(/MCQ_CHOICE_MIN_H/);
    expect(src).toMatch(/MCQ_CHOICE_RADIUS/);
    expect(src).toMatch(/WORD_CARD_RADIUS/);
    // The four wrong literals it used to carry.
    expect(src).not.toMatch(/height=\{52\}/);
    expect(src).not.toMatch(/radius=\{12\}/);
    expect(src).not.toMatch(/height=\{6\}/);
    expect(src).not.toMatch(/height=\{160\}/);
  });

  it('draws four rows from the constant, not a hand-written list', () => {
    const src = code('components/quiz/QuizCardSkeleton.tsx');
    expect(src).toMatch(/length: MCQ_CHOICE_COUNT/);
  });

  it('the word-card placeholder is a plausible card height', () => {
    // 28pt padding + a ~44pt serif line + 8pt + a 17pt subtitle + 28pt.
    expect(WORD_CARD_H).toBeGreaterThan(100);
    expect(WORD_CARD_H).toBeLessThan(160);
    expect(WORD_CARD_RADIUS).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// 2. The loading state wears the same chrome as the loaded state
// ---------------------------------------------------------------------------

describe('ReviewScreen keeps one header across every phase', () => {
  const src = code('components/ReviewScreen.tsx');

  it('uses QuizHeader everywhere, not a second paper bar', () => {
    // Loading, error and empty each rendered their own header: a paper bar
    // with a "← Back" text label. So the top of the screen changed shape the
    // instant the first card arrived, on top of the body changing.
    expect(src).not.toMatch(/styles\.headerTitle/);
    expect(src).not.toMatch(/styles\.backText/);
    expect(src).not.toMatch(/← Back/);
  });

  it('delegates the loading body to the shared skeleton', () => {
    expect(src).toMatch(/<QuizCardSkeleton \/>/);
  });
});

// ---------------------------------------------------------------------------
// 3. No screen stands a spinner in for content it could draw
// ---------------------------------------------------------------------------

describe('content loads behind skeletons, not spinners', () => {
  /**
   * Screens whose *content* placeholder is a skeleton now. A bare
   * `ActivityIndicator` returning to any of these is the regression — the
   * pre-skeleton pattern creeping back one screen at a time.
   *
   * Deliberately not a blanket ban. Spinners are right in three places and
   * all three still have them:
   *   • inside a button the user just pressed (Login, Settings save, Report),
   *   • a pagination footer at the end of a list already on screen,
   *   • `LoadingScreen`, the cold-boot gate, where there is no known layout
   *     to draw yet.
   */
  const CONVERTED = [
    'components/screens/SearchResultsScreen.tsx',
    'components/onboarding/PickFirstFilmStep.tsx',
    'components/explore/ListPanel.tsx',
    'components/ReviewScreen.tsx',
    'components/screens/ListDetailScreen.tsx',
    'components/FamilyPlanScreen.tsx',
  ];

  it.each(CONVERTED)('%s draws a skeleton while it loads', (rel) => {
    const src = code(rel);
    const usesSkeleton =
      /Skeleton/.test(src) || /ListItemsSkeleton|QuizCardSkeleton|FeedSkeleton/.test(src);
    expect(usesSkeleton).toBe(true);
  });

  it('no full-screen spinner survives on the converted screens', () => {
    // `size="large"` is the tell: a small one is a button or a footer, a large
    // centred one is standing in for a whole screenful of content.
    const offenders = CONVERTED.filter((rel) => /size="large"/.test(code(rel)));
    expect(offenders).toEqual([]);
  });

  it('the screens that dropped their spinner entirely no longer import one', () => {
    for (const rel of [
      'components/onboarding/PickFirstFilmStep.tsx',
      'components/explore/ListPanel.tsx',
      'components/ReviewScreen.tsx',
      'components/FamilyPlanScreen.tsx',
    ]) {
      expect(code(rel)).not.toMatch(/ActivityIndicator/);
    }
  });

  it('leaves the three kinds of spinner that are correct', () => {
    // Stated as a test so a later sweep doesn't "finish the job" by deleting
    // them. A button spinner reports on the press the user just made; a
    // footer spinner sits under a list already on screen; LoadingScreen is
    // the cold-boot gate, where there is no known layout to draw yet.
    expect(code('components/screens/LoginScreen.tsx')).toMatch(/ActivityIndicator/);
    expect(code('components/home/RankedMovieList.tsx')).toMatch(/ActivityIndicator/);
    expect(code('components/ui/LoadingScreen.tsx')).toMatch(/ActivityIndicator/);
  });
});

// ---------------------------------------------------------------------------
// 4. Nothing hand-rolls a placeholder next to the primitive
// ---------------------------------------------------------------------------

describe('placeholders go through the Skeleton primitive', () => {
  /**
   * The primitive owns the pulse, the sheen, the theme token, the
   * reduce-motion fallback and the screen-reader opt-out. A hand-rolled grey
   * `View` gets none of those and looks identical in a screenshot — which is
   * exactly why three of them survived: static bars in a frozen purple that
   * never animated and never turned over in dark mode.
   */
  it('no component paints its own skeleton bar', () => {
    const files = [
      'components/ExploreScreen.tsx',
      'components/screens/MovieDetailScreen.tsx',
      'components/common/FeedSkeleton.tsx',
      'components/quiz/QuizCardSkeleton.tsx',
      'components/lists/ListItemRows.tsx',
    ];
    for (const rel of files) {
      const src = code(rel);
      // The frozen purple the MovieDetail bars used, in every casing.
      expect(src).not.toMatch(/rgba\(124,\s*92,\s*191/i);
      // A View styled with the skeleton token directly, bypassing the pulse.
      expect(src).not.toMatch(/backgroundColor:\s*tc\.skeleton\b/);
    }
  });

  it('the dead pre-skeleton styles are gone from core/styles', () => {
    // Five styles (skeletonContainer/Row/Poster/Info/Line) from the era before
    // the primitive existed, referenced by nothing for months.
    const src = read('core/styles.ts');
    for (const name of [
      'skeletonContainer',
      'skeletonRow',
      'skeletonPoster',
      'skeletonInfo',
      'skeletonLine',
    ]) {
      expect(src).not.toMatch(new RegExp(`\\b${name}:`));
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The primitive's own contract
// ---------------------------------------------------------------------------

describe('the Skeleton primitive', () => {
  const src = code('components/ui/Skeleton.tsx');

  it('is invisible to screen readers on both platforms', () => {
    // iOS honours `accessibilityElementsHidden`, Android
    // `importantForAccessibility` — shipping one is shipping it for one OS.
    expect(src).toMatch(/accessibilityElementsHidden/);
    expect(src).toMatch(/importantForAccessibility="no-hide-descendants"/);
    // Both render paths: the sheen variant and the pulse variant.
    expect(src.match(/accessibilityElementsHidden/g)).toHaveLength(2);
  });

  it('honours reduce-motion', () => {
    expect(src).toMatch(/isReduceMotionEnabled/);
    expect(src).toMatch(/reduceMotion \? 0\.7 : pulse/);
  });

  it('animates on the native driver only', () => {
    // Opacity and transform are compositor-thread properties; anything that
    // drives width or height would animate layout on the JS thread and
    // stutter behind exactly the work the skeleton is covering for.
    expect(src).not.toMatch(/useNativeDriver:\s*false/);
    const drivers = src.match(/useNativeDriver:\s*true/g) ?? [];
    expect(drivers.length).toBeGreaterThanOrEqual(3);
  });

  it('defaults its colour to the theme token', () => {
    expect(src).toMatch(/color \?\? tc\.skeleton/);
  });
});

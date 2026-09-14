/**
 * The lazily-mounted tabs draw their real content in their first frame.
 *
 * Measured on the first tap after a cold start, before this:
 *   • Practice — the tile path empty for ~110ms, then ONE frame scrolled to the
 *     top of the path (locked tiles 38–46), then a jump down to START.
 *   • Explore (the film feed) — ~300ms of skeleton rows, then cards with no
 *     pictures, then the pictures popping in one card at a time.
 * After: Practice settled 10ms after its first frame; the film feed's first
 * frame had the cards, and every picture was in within 7ms.
 *
 * Every piece of this is invisible on any later tap, and nothing at runtime
 * fails if it regresses — the content still arrives. Source-reading, because
 * there is no component-render library in this suite by project rule.
 */

import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

describe('launch reads what the lazy tabs open on', () => {
  const app = () => read('core', 'App.tsx');

  it('hydrates the practice path for the signed-in account', () => {
    // On mount, the read resolved a frame after the tab's first paint.
    expect(app()).toMatch(/usePracticePathStore\.getState\(\)\.hydrate\(\)/);
  });

  it('primes the film feed at the level the feed will open on', () => {
    expect(app()).toMatch(/primeCefrMoviesCache\(profileLevel\)/);
    // `useFeedLevel` falls back to DEFAULT_LEVEL; a different fallback here
    // would prime a page nobody asks for.
    expect(app()).toMatch(/user\?\.proficiency_level \|\| DEFAULT_LEVEL/);
  });

  it('warms the pictures through the same URL builder the card uses', () => {
    // A different image size is a different cache entry: warming w500 while
    // the card draws w780 would warm nothing.
    expect(app()).toMatch(/cardBackdropUri\(movie\)/);
    expect(app()).toMatch(/Image\.prefetch\(uri\)/);
    expect(read('components', 'filmFeed', 'RankedMovieList.tsx'))
      .toMatch(/const backdropUri = cardBackdropUri\(movie\);/);
  });

  it('sends no request to do it', () => {
    // The hook's docblock rejects prefetching the feed at boot because it
    // spends an API call on every launch. Priming is a disk read.
    const hook = read('hooks', 'useInfiniteCefrMovies.ts');
    const prime = hook.slice(
      hook.indexOf('export async function primeCefrMoviesCache'),
      hook.indexOf('export function useInfiniteCefrMovies'),
    );
    expect(prime).toMatch(/readCache/);
    expect(prime).not.toMatch(/wordwiseApi|enrichMoviesWithTmdb|fetch\(/);
  });
});

describe('the film feed knows about its ad slot before it draws', () => {
  // For a free reader the slot sits above the list. Decided late, it arrived a
  // frame after the cards and pushed every one of them 48pt down.
  const feed = () => read('components', 'screens', 'FilmFeedScreen.tsx');

  it('reads whether this is the first session at launch', () => {
    expect(read('core', 'App.tsx')).toMatch(/useFirstSessionStore\.getState\(\)\.hydrate\(\)/);
  });

  it('takes the answer from the store, not from its own read on mount', () => {
    expect(feed()).toMatch(/const showAds = showAdsEntitlement && openedBefore;/);
    expect(feed()).not.toMatch(/getItem\('has_opened_before'\)/);
    expect(feed()).not.toMatch(/setIsFirstSession/);
  });
});

describe('the practice path is not drawn before it is anchored', () => {
  const screen = () => read('components', 'PracticeScreen.tsx');

  it('hides the path until the first scroll to the bottom has been sent', () => {
    const s = screen();
    expect(s).toMatch(/style=\{\[s\.pathWrap, !pathSettled && s\.pathUnsettled\]\}/);
    expect(s).toMatch(/pathUnsettled: \{\s*opacity: 0,/);
  });

  it('reveals it after the scroll, in the same handler', () => {
    const s = screen();
    const handler = s.slice(s.indexOf('onContentSizeChange={'), s.indexOf('onContentSizeChange={') + 400);
    expect(handler.indexOf('scrollToEnd')).toBeGreaterThan(-1);
    expect(handler.indexOf('setPathSettled(true)')).toBeGreaterThan(handler.indexOf('scrollToEnd'));
  });

  it('never hides it again — a later re-anchor moves a path already on screen', () => {
    expect(screen().match(/setPathSettled\(/g)).toHaveLength(1);
  });

  it('uses opacity, not unmounting — the path must lay out to be anchored', () => {
    // `{pathSettled ? <Path/> : null}` would never produce the content size
    // the anchor waits for, and the tab would stay empty.
    expect(screen()).not.toMatch(/pathSettled \?/);
  });
});

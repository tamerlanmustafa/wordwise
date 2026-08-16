import { PARENT_OF, PROFILE_SHEET } from '../navParents';
import type { Screen } from '../types';

describe('PARENT_OF', () => {
  it('returns sheet-launched screens to the Profile sheet', () => {
    const fromSheet: Screen[] = [
      'settings',
      'stats',
      'achievements',
      'leaderboard',
      'vocabulary',
      'admin',
      // The "My Lists" hub was replaced by the Lists tab; the two screens it
      // uniquely reached are now linked from the sheet directly.
      'notebook',
      'watched',
    ];
    for (const screen of fromSheet) {
      expect(PARENT_OF[screen]).toBe(PROFILE_SHEET);
    }
  });

  it('returns Settings sub-screens to Settings, not Home', () => {
    // The reported bug: these three are opened from inside Settings but used
    // to drop the user on Home.
    expect(PARENT_OF.familyPlan).toBe('settings');
    expect(PARENT_OF.privacy).toBe('settings');
    expect(PARENT_OF.terms).toBe('settings');
  });

  it('returns second-level lists to the list they were opened from', () => {
    expect(PARENT_OF.learnedWords).toBe('vocabulary');
    // An open list returns to the Lists tab index, not to Home.
    expect(PARENT_OF.listDetail).toBe('lists');
  });

  it('leaves the Lists tab itself parentless like every other root tab', () => {
    // 'lists' used to be a sheet-launched hub screen. As a tab it must not
    // have a parent, or hardware back would bounce it into the Profile sheet.
    expect(PARENT_OF.lists).toBeUndefined();
  });

  it('returns the saved reel to the Profile sheet it is now opened from', () => {
    // My Movies lost its tab to Explore; the reel hangs off the sheet.
    expect(PARENT_OF.savedMovies).toBe(PROFILE_SHEET);
  });

  it('leaves root tabs parentless so hardware back can exit the app', () => {
    const rootTabs: Screen[] = ['home', 'explore', 'journey', 'practice', 'lists'];
    for (const screen of rootTabs) {
      expect(PARENT_OF[screen]).toBeUndefined();
    }
  });

  it('leaves the non-account flows to their own bespoke handlers', () => {
    // Quiz/review/detail screens unwind through their own state (session,
    // preview tile, movie), so they must fall through to App's Home fallback
    // rather than being short-circuited by this map.
    const bespoke: Screen[] = [
      'movieDetail',
      'searchResults',
      'review',
      'paywall',
      'quizJourney',
      'quizLesson',
      'quizResult',
      'quizBatchBuilder',
      'quizBatchJourney',
      'moviePreview',
      'setIntro',
      'addToReel',
    ];
    for (const screen of bespoke) {
      expect(PARENT_OF[screen]).toBeUndefined();
    }
  });

  it('never points a screen at itself or forms a cycle', () => {
    for (const key of Object.keys(PARENT_OF) as Screen[]) {
      const seen = new Set<string>([key]);
      let cursor = PARENT_OF[key];
      while (cursor && cursor !== PROFILE_SHEET) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = PARENT_OF[cursor as Screen];
      }
      // Every chain has to terminate at the sheet or a root tab — otherwise
      // Back would strand the user on a screen with nowhere to go.
      expect(cursor === PROFILE_SHEET || cursor === undefined).toBe(true);
    }
  });
});

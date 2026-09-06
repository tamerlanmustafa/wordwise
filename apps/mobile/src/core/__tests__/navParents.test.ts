import { PARENT_OF } from '../navParents';
import type { Screen } from '../types';

describe('PARENT_OF', () => {
  it('returns account-area screens to the Profile hub', () => {
    // Profile was a bottom sheet until 2026-09-05, which needed a sentinel
    // parent (`PROFILE_SHEET`) because an overlay is not a screen. It is a
    // screen now, so these are ordinary parents.
    const fromProfile: Screen[] = [
      'settings',
      'notificationSettings',
      'account',
      'legal',
      'stats',
      'achievements',
      'leaderboard',
      'vocabulary',
      'admin',
      // The "My Lists" hub was replaced by the Lists tab; the two screens it
      // uniquely reached are now linked from Profile directly.
      'notebook',
      'watched',
    ];
    for (const screen of fromProfile) {
      expect(PARENT_OF[screen]).toBe('profile');
    }
  });

  it('returns each sub-screen to the page that links it, not Home', () => {
    // The original bug was that these dropped the user on Home. They have
    // since moved off Settings — subscription onto Account, the two documents
    // onto Legal — so the parents moved with them.
    expect(PARENT_OF.familyPlan).toBe('account');
    expect(PARENT_OF.privacy).toBe('legal');
    expect(PARENT_OF.terms).toBe('legal');
  });

  it('returns second-level lists to the list they were opened from', () => {
    expect(PARENT_OF.learnedWords).toBe('vocabulary');
    // An open list returns to the Lists tab index, not to Home.
    expect(PARENT_OF.listDetail).toBe('lists');
  });

  it('leaves the Lists tab itself parentless like every other root tab', () => {
    // 'lists' used to be a hub screen launched from Profile. As a tab it must
    // not have a parent, or hardware back would bounce it into Profile.
    expect(PARENT_OF.lists).toBeUndefined();
  });

  it('leaves Profile parentless — it is a tab root now, not an overlay', () => {
    // The whole point of the change: Profile is a destination, so hardware
    // back from it behaves like any other root tab rather than closing a sheet.
    expect(PARENT_OF.profile).toBeUndefined();
  });

  it('returns the saved reel to the Profile hub it is opened from', () => {
    // My Movies lost its tab to Explore; the reel hangs off Profile.
    expect(PARENT_OF.savedMovies).toBe('profile');
  });

  it('leaves root tabs parentless so hardware back can exit the app', () => {
    const rootTabs: Screen[] = ['films', 'words', 'journey', 'practice', 'lists'];
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
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = PARENT_OF[cursor as Screen];
      }
      // Every chain has to terminate at a parentless root — otherwise
      // Back would strand the user on a screen with nowhere to go.
      expect(cursor).toBeUndefined();
    }
  });
});

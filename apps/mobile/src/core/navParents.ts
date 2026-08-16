/**
 * Where Back goes, for every screen in the account area.
 *
 * Navigation is a single flat `currentScreen` string, so each screen's Back
 * used to be hand-wired twice — once as an `onBack` prop in App's render
 * ternary, and again in the Android hardware-back handler. The two drifted:
 * Admin, Family Plan, Privacy and Terms dropped the user on Home instead of
 * where they came from, and hardware back sent *every* deep screen to Home
 * regardless of what its on-screen Back did.
 *
 * Both paths now read this map, so a screen can only have one Back
 * destination. Screens absent from it (movie detail, quiz flow, review…) keep
 * their bespoke handlers and fall back to Home on hardware back.
 */

import type { Screen } from './types';

/**
 * Sentinel parent: return to the base tab the Profile sheet was opened over
 * and slide the sheet back up. It isn't a `Screen` because the sheet is an
 * overlay rather than a screen — it rides on top of whichever tab is showing.
 */
export const PROFILE_SHEET = 'profileSheet';

export type BackTarget = Screen | typeof PROFILE_SHEET;

export const PARENT_OF: Partial<Record<Screen, BackTarget>> = {
  // Launched from the Profile sheet → Back re-opens the sheet.
  settings: PROFILE_SHEET,
  stats: PROFILE_SHEET,
  achievements: PROFILE_SHEET,
  leaderboard: PROFILE_SHEET,
  vocabulary: PROFILE_SHEET,
  admin: PROFILE_SHEET,
  // The saved reel lost its tab to Explore and now hangs off the sheet.
  savedMovies: PROFILE_SHEET,
  // Opened from inside Settings → Back steps into Settings, not out to Home.
  familyPlan: 'settings',
  privacy: 'settings',
  terms: 'settings',
  // Second-level lists, reached from their parent list screen.
  learnedWords: 'vocabulary',
  // Both were reached through the old "My Lists" hub, which the Lists tab
  // replaced; the Profile sheet now links them directly.
  notebook: PROFILE_SHEET,
  watched: PROFILE_SHEET,
  // An open list returns to the Lists tab index.
  listDetail: 'lists',
};

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
 * Profile used to be an overlay, which needed a sentinel parent here and a
 * remembered "tab it opened over" in App.tsx. It is a screen now, so Back is
 * just another entry in this map and the sentinel is gone.
 */
export type BackTarget = Screen;

export const PARENT_OF: Partial<Record<Screen, BackTarget>> = {
  // Launched from the Profile hub.
  settings: 'profile',
  notificationSettings: 'profile',
  account: 'profile',
  legal: 'profile',
  stats: 'profile',
  achievements: 'profile',
  leaderboard: 'profile',
  vocabulary: 'profile',
  admin: 'profile',
  // The saved reel lost its tab to Explore and now hangs off Profile.
  savedMovies: 'profile',
  // Subscription lives on Account; the two documents live on Legal. Back steps
  // into the page that linked here, not out to Home.
  familyPlan: 'account',
  privacy: 'legal',
  terms: 'legal',
  // Second-level lists, reached from their parent list screen.
  learnedWords: 'vocabulary',
  // Both were reached through the old "My Lists" hub, which the Lists tab
  // replaced; Profile links them directly.
  notebook: 'profile',
  watched: 'profile',
  // An open list returns to the Lists tab index.
  listDetail: 'lists',
};

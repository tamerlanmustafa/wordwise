/**
 * Where each tab was when you last left it.
 *
 * Tapping a tab used to always land on that tab's root, so opening a film,
 * glancing at Practice and coming back threw the film away — and with it the
 * card you were on, the deck's position and the scroll you had built up. The
 * work of getting somewhere was lost to a two-second detour, which is the one
 * thing a tab bar is supposed to make free.
 *
 * Native tab navigators solve this by giving every tab its own stack. This app
 * navigates with a single flat `currentScreen` string (see `navParents`), so
 * there are no stacks to keep — but a tab only needs to remember *one* thing,
 * the screen it was showing, and that is a map.
 *
 * ## Re-tapping the tab you are on still resets
 *
 * That is the platform convention — Instagram, Twitter and the App Store all
 * do it — and it is also the escape hatch: without it, a remembered movie
 * detail would be a room with the door locked behind you, since the tab that
 * used to take you back to the feed now takes you to the film. So the tab bar
 * keeps both meanings, chosen by where you already are.
 *
 * Pure, so the rules can be tested without a navigator.
 */

import type { BottomTab } from '../components/GlobalBottomBar';
import type { Screen } from './types';
import { PARENT_OF } from './navParents';

/** The screen a tab shows when nothing is remembered for it. */
export const TAB_ROOT: Record<BottomTab, Screen> = {
  films: 'films',
  words: 'words',
  practice: 'practice',
  lists: 'lists',
  profile: 'profile',
};

const ROOTS = Object.values(TAB_ROOT) as Screen[];

/**
 * Screens whose owning tab cannot be derived from `PARENT_OF`.
 *
 * Movie detail is absent from that map because its Back is conditional — it
 * returns to the reel preview hub when you arrived from there — so it has a
 * bespoke handler rather than a static parent. It still belongs to the film
 * feed for the purpose of "which tab was I in".
 */
const TAB_OF_EXTRA: Partial<Record<Screen, BottomTab>> = {
  movieDetail: 'films',
};

/** Guards the `PARENT_OF` walk against a cycle introduced by a future edit. */
const MAX_DEPTH = 8;

/**
 * Which tab a screen lives under, or null if it belongs to no tab — the quiz
 * flow, the paywall and the login screen are not part of any tab's history.
 */
export function tabOf(screen: Screen): BottomTab | null {
  const direct = (Object.keys(TAB_ROOT) as BottomTab[]).find((t) => TAB_ROOT[t] === screen);
  if (direct) return direct;
  if (TAB_OF_EXTRA[screen]) return TAB_OF_EXTRA[screen] ?? null;

  let cursor: Screen | undefined = screen;
  for (let i = 0; i < MAX_DEPTH && cursor; i += 1) {
    cursor = PARENT_OF[cursor];
    if (!cursor) return null;
    if (ROOTS.includes(cursor)) return tabOf(cursor);
  }
  return null;
}

/**
 * Whether a screen is worth returning someone to.
 *
 * Derived from `PARENT_OF` rather than listed here, and that is the load-
 * bearing part. A screen is in that map because it is a stable destination
 * with a fixed way back; the quiz lesson, the review session, the paywall and
 * the set intro are deliberately absent from it because they are *steps in a
 * flow*, and dropping someone back into the middle of one from a tab tap is
 * worse than dropping them at the root.
 *
 * So the two facts stay in step for free: adding a new stable screen means
 * giving it a Back parent anyway, and that is what makes it resumable. A new
 * flow screen gets neither, and is skipped by default — the safe direction.
 *
 * Movie detail is the one addition, for the reason `TAB_OF_EXTRA` gives.
 */
export function isResumable(screen: Screen): boolean {
  if (ROOTS.includes(screen)) return false; // a root is what "no memory" means
  return screen in TAB_OF_EXTRA || screen in PARENT_OF;
}

export type TabMemory = Partial<Record<BottomTab, Screen>>;

/**
 * The memory after leaving `from` for another tab.
 *
 * Leaving a tab at its root *clears* that tab's memory. Without this, opening
 * a film, backing out to the feed, and then leaving the tab would still
 * restore the film later — a screen you had explicitly closed coming back on
 * its own, which reads as the app ignoring you rather than remembering you.
 */
export function remember(memory: TabMemory, from: Screen): TabMemory {
  const tab = tabOf(from);
  if (!tab) return memory;
  const next = { ...memory };
  if (isResumable(from)) next[tab] = from;
  else delete next[tab];
  return next;
}

/**
 * The screen a tab tap should land on.
 *
 * `currentTab` is the tab the user is already in — null while they are
 * somewhere outside the tabs, such as mid-quiz.
 */
export function screenForTabPress(
  tab: BottomTab,
  currentTab: BottomTab | null,
  memory: TabMemory,
): Screen {
  if (currentTab === tab) return TAB_ROOT[tab];
  return memory[tab] ?? TAB_ROOT[tab];
}

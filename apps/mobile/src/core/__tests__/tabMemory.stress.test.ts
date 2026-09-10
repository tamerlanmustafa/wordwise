/**
 * The tab bar, tapped faster than anyone means to.
 *
 * Every bug in this area has been a sequence bug. "Switch tabs and come back"
 * broke three separate ways in one week — a screen that remounted, a deck torn
 * down by a 140ms timer that kept re-arming, a card count still settling while
 * the reader was away. None of them needed an unusual tab; they needed an
 * unusual *order*.
 *
 * `tabMemory` is the pure half of that, so it is the half that can be driven
 * hard. What must hold no matter how the taps land:
 *
 *   • a tap always lands somewhere renderable — never a screen with no route
 *   • re-tapping the tab you are on always resets it (the escape hatch)
 *   • a tab left at its root forgets, so a screen you closed stays closed
 *   • the memory never grows past one entry per tab
 *   • nothing you can do makes it remember a root as if it were a destination
 *
 * Seeded, so a red run names the tap sequence (see test-utils/fuzz).
 */

import {
  isResumable,
  remember,
  screenForTabPress,
  tabOf,
  TAB_ROOT,
  type TabMemory,
} from '../tabMemory';
import { PARENT_OF } from '../navParents';
import type { Screen } from '../types';
import type { BottomTab } from '../../components/GlobalBottomBar';
import { forSeeds } from '../../test-utils/fuzz';

const TABS = Object.keys(TAB_ROOT) as BottomTab[];
const ROOTS = Object.values(TAB_ROOT) as Screen[];
/** Every screen the app can be on: the roots, plus everything with a Back. */
const SCREENS = [...new Set<Screen>([...ROOTS, ...(Object.keys(PARENT_OF) as Screen[]), 'movieDetail'])];

describe('random tab-tap storms', () => {
  it('always lands on a screen the app can render', () => {
    forSeeds(30, (rng) => {
      let memory: TabMemory = {};
      let current: Screen = 'films';
      for (let tap = 0; tap < 400; tap += 1) {
        // Between taps the user may navigate deeper inside the tab.
        if (rng.chance(0.4)) current = rng.pick(SCREENS);
        const tab = rng.pick(TABS);
        memory = remember(memory, current);
        current = screenForTabPress(tab, tabOf(current), memory);
        expect(SCREENS).toContain(current);
      }
    });
  });

  it('never remembers more than one screen per tab', () => {
    // The memory is a map, so unbounded growth would mean a key that is not a
    // tab — which is the shape a typo in `tabOf` would take.
    forSeeds(20, (rng) => {
      let memory: TabMemory = {};
      let current: Screen = 'films';
      for (let tap = 0; tap < 300; tap += 1) {
        if (rng.chance(0.5)) current = rng.pick(SCREENS);
        memory = remember(memory, current);
        expect(Object.keys(memory).length).toBeLessThanOrEqual(TABS.length);
        for (const key of Object.keys(memory)) expect(TABS).toContain(key as BottomTab);
      }
    });
  });

  it('never remembers a root, however you arrive at one', () => {
    // A remembered root is indistinguishable from no memory when it is read,
    // but it is the state that makes "leaving a tab at its root clears it"
    // untrue — and that rule is what stops a film you explicitly backed out of
    // reappearing later on its own.
    forSeeds(20, (rng) => {
      let memory: TabMemory = {};
      for (let tap = 0; tap < 300; tap += 1) {
        memory = remember(memory, rng.pick(SCREENS));
        for (const screen of Object.values(memory)) {
          expect(ROOTS).not.toContain(screen);
          expect(isResumable(screen as Screen)).toBe(true);
        }
      }
    });
  });

  it('keeps re-tapping the current tab as the way out', () => {
    // The platform convention, and the escape hatch: without it a remembered
    // movie detail is a room with the door locked behind you, because the tab
    // that used to take you back to the feed now takes you to the film.
    forSeeds(20, (rng) => {
      let memory: TabMemory = {};
      for (let tap = 0; tap < 200; tap += 1) {
        memory = remember(memory, rng.pick(SCREENS));
        const tab = rng.pick(TABS);
        expect(screenForTabPress(tab, tab, memory)).toBe(TAB_ROOT[tab]);
      }
    });
  });

  it('resumes exactly what it stored, and only that', () => {
    forSeeds(20, (rng) => {
      let memory: TabMemory = {};
      let current: Screen = 'films';
      for (let tap = 0; tap < 300; tap += 1) {
        if (rng.chance(0.5)) current = rng.pick(SCREENS);
        const from = tabOf(current);
        memory = remember(memory, current);
        const tab = rng.pick(TABS.filter((t) => t !== from));
        const landed = screenForTabPress(tab, from, memory);
        // Either the tab's own remembered screen, or its root. Never another
        // tab's screen — that is what a shared key would look like.
        expect(landed === memory[tab] || landed === TAB_ROOT[tab]).toBe(true);
        if (landed !== TAB_ROOT[tab]) expect(tabOf(landed)).toBe(tab);
        current = landed;
      }
    });
  });

  it('is idempotent: leaving the same screen twice stores the same thing', () => {
    // Two taps landing in one frame is a real event on a slow device, and the
    // second must not disturb what the first recorded.
    forSeeds(20, (rng) => {
      let memory: TabMemory = {};
      for (let tap = 0; tap < 200; tap += 1) {
        const screen = rng.pick(SCREENS);
        const once = remember(memory, screen);
        const twice = remember(once, screen);
        expect(twice).toEqual(once);
        memory = twice;
      }
    });
  });
});

describe('the Back ladder terminates from anywhere', () => {
  it('never walks in a circle', () => {
    // `tabOf` guards its own walk with MAX_DEPTH, which hides a cycle rather
    // than reporting it. This asserts the map itself is acyclic, so a future
    // edit that points two screens at each other fails here instead of
    // silently making Back stop working on both.
    for (const start of Object.keys(PARENT_OF) as Screen[]) {
      const seen = new Set<Screen>([start]);
      let cursor: Screen | undefined = PARENT_OF[start];
      while (cursor) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = PARENT_OF[cursor];
      }
    }
  });

  it('leads every screen to a root', () => {
    for (const start of Object.keys(PARENT_OF) as Screen[]) {
      let cursor: Screen | undefined = start;
      let hops = 0;
      while (cursor && !ROOTS.includes(cursor) && hops < 20) {
        cursor = PARENT_OF[cursor];
        hops += 1;
      }
      expect(cursor == null || ROOTS.includes(cursor)).toBe(true);
    }
  });
});

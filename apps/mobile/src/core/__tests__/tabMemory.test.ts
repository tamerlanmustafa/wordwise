import {
  TAB_ROOT,
  isResumable,
  remember,
  screenForTabPress,
  tabOf,
  type TabMemory,
} from '../tabMemory';
import { PARENT_OF } from '../navParents';
import type { Screen } from '../types';

describe('tabOf', () => {
  it('places each tab root under itself', () => {
    expect(tabOf('films')).toBe('films');
    expect(tabOf('words')).toBe('words');
    expect(tabOf('practice')).toBe('practice');
    expect(tabOf('lists')).toBe('lists');
    expect(tabOf('profile')).toBe('profile');
  });

  it('puts movie detail under the film feed', () => {
    // Absent from PARENT_OF because its Back is conditional — it returns to
    // the reel preview hub when you arrived from there — so it needs the
    // explicit entry.
    expect(tabOf('movieDetail')).toBe('films');
  });

  it('walks the parent chain to a root', () => {
    // familyPlan → account → profile, two hops.
    expect(tabOf('familyPlan')).toBe('profile');
    expect(tabOf('privacy')).toBe('profile');
    expect(tabOf('listDetail')).toBe('lists');
  });

  it('returns null for screens no tab owns', () => {
    // A quiz lesson, the paywall and the set intro are steps in a flow. A tab
    // has no business remembering them, and the bottom bar has no business
    // lighting up during one.
    const outside: Screen[] = ['quizLesson', 'quizResult', 'paywall', 'setIntro', 'journey'];
    for (const screen of outside) expect(tabOf(screen)).toBeNull();
  });
});

describe('isResumable', () => {
  it('says no to a tab root', () => {
    // A root *is* what "nothing remembered" means, so storing one would be a
    // memory that changes nothing.
    for (const root of Object.values(TAB_ROOT)) expect(isResumable(root)).toBe(false);
  });

  it('says yes to movie detail', () => {
    expect(isResumable('movieDetail')).toBe(true);
  });

  it('says yes to everything with a Back parent', () => {
    // The derivation, asserted directly: a screen is in PARENT_OF because it
    // is a stable destination, and that is exactly what makes it worth
    // returning to. The two facts stay in step without being listed twice.
    for (const screen of Object.keys(PARENT_OF) as Screen[]) {
      expect(isResumable(screen)).toBe(true);
    }
  });

  it('says no to the flow screens, which deliberately have no parent', () => {
    // The safe direction: a screen nobody has thought about is skipped rather
    // than resumed into.
    const flows: Screen[] = ['quizLesson', 'quizResult', 'review', 'paywall', 'setIntro'];
    for (const screen of flows) expect(isResumable(screen)).toBe(false);
  });
});

describe('remember', () => {
  it('stores a deep screen under its own tab', () => {
    expect(remember({}, 'movieDetail')).toEqual({ films: 'movieDetail' });
    expect(remember({}, 'listDetail')).toEqual({ lists: 'listDetail' });
  });

  it('clears the tab when it is left at its root', () => {
    // The bug this prevents: open a film, back out to the feed, switch tabs,
    // come back — and the film you explicitly closed reappears. That reads as
    // the app ignoring you, not remembering you.
    expect(remember({ films: 'movieDetail' }, 'films')).toEqual({});
  });

  it('leaves other tabs alone', () => {
    const before: TabMemory = { lists: 'listDetail', profile: 'account' };
    expect(remember(before, 'movieDetail')).toEqual({
      lists: 'listDetail',
      profile: 'account',
      films: 'movieDetail',
    });
  });

  it('does not mutate the memory it was given', () => {
    // It feeds React state; mutating in place would skip the re-render.
    const before: TabMemory = { films: 'movieDetail' };
    remember(before, 'listDetail');
    expect(before).toEqual({ films: 'movieDetail' });
  });

  it('ignores a screen no tab owns', () => {
    // Leaving mid-quiz must not overwrite whatever a tab was holding.
    const before: TabMemory = { films: 'movieDetail' };
    expect(remember(before, 'quizLesson')).toEqual(before);
  });
});

describe('screenForTabPress', () => {
  it('resumes a remembered screen when arriving from another tab', () => {
    expect(screenForTabPress('films', 'practice', { films: 'movieDetail' })).toBe('movieDetail');
  });

  it('goes to the root when the tab has no memory', () => {
    expect(screenForTabPress('films', 'practice', {})).toBe('films');
  });

  it('resets when you re-tap the tab you are already in', () => {
    // The platform convention, and the escape hatch: without it a remembered
    // film would be a room with the door locked, because the control that
    // used to return you to the feed now returns you to the film.
    expect(screenForTabPress('films', 'films', { films: 'movieDetail' })).toBe('films');
  });

  it('resumes when the user is outside the tabs entirely', () => {
    // Leaving a quiz by tapping a tab should still land where that tab was.
    expect(screenForTabPress('films', null, { films: 'movieDetail' })).toBe('movieDetail');
  });
});

describe('the whole trip', () => {
  it('keeps the film across a detour and gives it back', () => {
    let memory: TabMemory = {};
    let screen: Screen = 'movieDetail';

    // → Practice
    memory = remember(memory, screen);
    screen = screenForTabPress('practice', tabOf(screen), memory);
    expect(screen).toBe('practice');

    // → back to the film feed's tab
    memory = remember(memory, screen);
    screen = screenForTabPress('films', tabOf(screen), memory);
    expect(screen).toBe('movieDetail');

    // Re-tap Explore: out to the feed.
    memory = remember(memory, screen);
    screen = screenForTabPress('films', tabOf(screen), memory);
    expect(screen).toBe('films');

    // And now the film is genuinely forgotten, not lurking.
    memory = remember(memory, screen);
    expect(memory.films).toBeUndefined();
  });
});

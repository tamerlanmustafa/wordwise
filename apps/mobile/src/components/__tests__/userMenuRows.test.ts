/**
 * Which rows the profile sheet shows.
 *
 * Not a render test (mobile testing is logic + integration only — see
 * CLAUDE.md). What can regress here is a hidden row quietly coming back, or a
 * row that must never be hidden — Settings, and account access for admins —
 * being swept up with the rest.
 */

import { HIDDEN_MENU_ROWS, MENU_ROW_KEYS, visibleMenuRows } from '../userMenuRows';

describe('hidden rows', () => {
  it('hides exactly the eight rows parked for now', () => {
    expect([...HIDDEN_MENU_ROWS].sort()).toEqual([
      'badges',
      'leaderboard',
      'myMovies',
      'notifications',
      'progress',
      'savedWords',
      'vocabulary',
      'watchedFilms',
    ]);
  });

  it('only hides rows the sheet actually knows about', () => {
    // A typo'd key would hide nothing and fail silently in the UI.
    for (const key of HIDDEN_MENU_ROWS) {
      expect(MENU_ROW_KEYS).toContain(key);
    }
  });
});

describe('visibleMenuRows', () => {
  it('leaves a non-admin with Settings alone', () => {
    expect(visibleMenuRows(false)).toEqual(['settings']);
  });

  it('keeps the admin panel reachable for admins', () => {
    expect(visibleMenuRows(true)).toEqual(['settings', 'admin']);
  });

  it('never shows the admin row to a normal account', () => {
    // Hiding and permission are separate gates; a row leaving HIDDEN_MENU_ROWS
    // must not be able to leak the admin row with it.
    expect(visibleMenuRows(false)).not.toContain('admin');
  });

  it('renders rows in the canonical order, not the order of the hidden set', () => {
    const visible = visibleMenuRows(true);
    const positions = visible.map((key) => MENU_ROW_KEYS.indexOf(key));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

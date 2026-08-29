/**
 * Which rows the profile sheet (UserMenuSheet) shows, and in what order.
 *
 * Split out of the component so the hidden-row decision is a plain list that
 * can be read and tested without mounting anything — mobile testing here is
 * logic + integration only (see CLAUDE.md).
 *
 * Hiding is done by *omission at render time*, not by deleting rows: every
 * handler, screen and store subscription behind a hidden row stays wired, so
 * bringing one back is a one-line edit to HIDDEN_MENU_ROWS rather than a
 * re-implementation.
 */

/**
 * Every row the profile sheet can render, in display order. The component
 * builds a `Record<MenuRowKey, …>`, so a key added here is a compile error
 * until it has an icon, a label and an action — the list and the UI cannot
 * drift apart.
 */
export const MENU_ROW_KEYS = [
  'notifications',
  'progress',
  'badges',
  'leaderboard',
  'savedWords',
  'watchedFilms',
  'myMovies',
  'vocabulary',
  'settings',
  'admin',
] as const;

export type MenuRowKey = (typeof MENU_ROW_KEYS)[number];

/**
 * Rows HIDDEN from the sheet for now. Everything behind them is untouched —
 * the navigation props in App.tsx, the screens they open, and the unread
 * subscription that feeds the notifications dot — so deleting a key from this
 * set is all it takes to restore the row exactly as it was.
 */
export const HIDDEN_MENU_ROWS: ReadonlySet<MenuRowKey> = new Set<MenuRowKey>([
  'notifications',
  'progress',
  'badges',
  'leaderboard',
  'savedWords',
  'watchedFilms',
  'myMovies',
  'vocabulary',
]);

/**
 * The rows to render, in order. `admin` is additionally gated on the account —
 * hiding and permission are separate reasons a row can be absent, and folding
 * them into one flag is how a hidden row later comes back for admins only.
 */
export function visibleMenuRows(isAdmin: boolean): MenuRowKey[] {
  return MENU_ROW_KEYS.filter(
    (key) => !HIDDEN_MENU_ROWS.has(key) && (key !== 'admin' || isAdmin),
  );
}

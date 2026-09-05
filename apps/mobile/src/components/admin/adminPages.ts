/**
 * adminPages — the admin screen's table of contents.
 *
 * Admin used to be one long scroll that fetched everything it could ever show
 * before painting anything. That is why it took five seconds to open: the
 * slowest question on the page was the cost of opening the page. It is a hub
 * of pages now, and each page fetches only its own data, the first time you
 * open it.
 *
 * The registry lives here rather than inline in the screen so that "which
 * pages exist, in what order, described how" is one list — and so the mapping
 * from page to the call it makes is something a test can assert rather than
 * something you confirm by reading a 2,000-line component.
 *
 * Pure: no React, no fetching.
 */

export type AdminPageId = 'workers' | 'films' | 'words' | 'users' | 'reports' | 'health';

export interface AdminPage {
  id: AdminPageId;
  /** Tile title on the hub, and the header title on the page itself. */
  label: string;
  /** One line under the tile: what you would come to this page to find out. */
  blurb: string;
  /**
   * Whether opening this page costs a network call of its own.
   *
   * `false` for Health, which is itself a hub of four reports that each fetch
   * when opened — putting a call behind the Health tile would fetch four
   * reports to render four buttons.
   */
  fetches: boolean;
}

export const ADMIN_PAGES: readonly AdminPage[] = [
  {
    id: 'workers',
    label: 'Workers',
    blurb: 'The four background processes: what they do and whether they are running.',
    fetches: true,
  },
  {
    id: 'films',
    label: 'Films',
    blurb: 'Catalogue size, what is graded, and the browser for every processed film.',
    fetches: true,
  },
  {
    id: 'words',
    label: 'Words',
    blurb: 'The dictionary: how many words, what level, and what we have written for them.',
    fetches: true,
  },
  {
    id: 'users',
    label: 'Users',
    blurb: 'Accounts, tiers, who came back — and granting Plus.',
    fetches: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    blurb: 'What users have flagged as wrong on a word.',
    fetches: true,
  },
  {
    id: 'health',
    label: 'Health',
    blurb: 'Vocabulary coverage, API latency, event loop, sign-in limits.',
    fetches: false,
  },
];

export function adminPage(id: AdminPageId): AdminPage {
  const found = ADMIN_PAGES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown admin page: ${id}`);
  return found;
}

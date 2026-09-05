/**
 * The admin hub's table of contents.
 *
 * This registry exists because admin used to be one page that fetched
 * everything before painting anything — `/admin/stats` measured 5,487 ms p95
 * on prod, and the cost of its slowest question was the cost of opening the
 * screen. The split only pays off if each page really does own its own call,
 * so that is what these assert.
 */

import { ADMIN_PAGES, adminPage, type AdminPageId } from '../adminPages';

describe('ADMIN_PAGES', () => {
  it('lists the six sections the screen is made of', () => {
    expect(ADMIN_PAGES.map((p) => p.id)).toEqual([
      'workers',
      'films',
      'words',
      'users',
      'reports',
      'health',
    ]);
  });

  it('gives every page a name and a sentence saying what it answers', () => {
    for (const page of ADMIN_PAGES) {
      expect(page.label).toBeTruthy();
      expect(page.blurb.length).toBeGreaterThan(20);
    }
  });

  it('has no duplicate ids or labels', () => {
    expect(new Set(ADMIN_PAGES.map((p) => p.id)).size).toBe(ADMIN_PAGES.length);
    expect(new Set(ADMIN_PAGES.map((p) => p.label)).size).toBe(ADMIN_PAGES.length);
  });

  it('marks Health as fetching nothing of its own', () => {
    // Health is a hub of four reports that each load when opened. Giving the
    // Health tile a call of its own would fetch four reports to render four
    // buttons — the same mistake, one level down.
    expect(adminPage('health').fetches).toBe(false);
  });

  it('marks every other page as owning a call', () => {
    for (const page of ADMIN_PAGES.filter((p) => p.id !== 'health')) {
      expect(page.fetches).toBe(true);
    }
  });

  it('describes pages without naming database tables', () => {
    // The audience is someone checking on the product, not someone who has
    // read the schema.
    for (const page of ADMIN_PAGES) {
      expect(page.blurb).not.toMatch(/lemma|movie_jobs|word_classification|cefr_level/i);
    }
  });

  it('refuses an unknown id rather than rendering an empty page', () => {
    expect(() => adminPage('nope' as AdminPageId)).toThrow(/unknown admin page/);
  });
});

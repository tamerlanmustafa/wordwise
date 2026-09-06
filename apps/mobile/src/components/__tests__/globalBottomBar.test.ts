/**
 * The 5-tab bar's shape and the space its labels have to fit in.
 *
 * These are deliberately not render tests (mobile testing is logic +
 * integration only — see CLAUDE.md). What can actually regress here is the
 * tab *order*, the label keys resolving in every shipped locale, and labels
 * outgrowing their cell — all checkable without mounting anything.
 */

import { TABS } from '../GlobalBottomBar';
import { NAMESPACES, resources } from '../../i18n/resources';

/** Narrowest device we support (iPhone SE), divided across five cells. */
const NARROWEST_WIDTH = 320;
const CELL_WIDTH = NARROWEST_WIDTH / 5; // 64pt

/**
 * Rough width of a 10px/800 label. RN gives no measurement API off-device, so
 * this is a conservative per-character estimate — the point is to catch a
 * label that is obviously too long, not to predict layout to the pixel.
 */
const PX_PER_CHAR = 6.2;
const HORIZONTAL_PADDING = 8;

function estimatedLabelWidth(label: string): number {
  return label.length * PX_PER_CHAR + HORIZONTAL_PADDING;
}

const LOCALES = Object.keys(resources);

describe('tab order', () => {
  it('reads Home · Explore · Practice · Lists · Profile to the user', () => {
    expect(TABS.map((t) => t.labelKey)).toEqual([
      'home', 'explore', 'practice', 'lists', 'profile',
    ]);
  });

  it('routes the first tab to the word feed and the second to the film feed', () => {
    // Ids name their content, labels name what we call it, and the two are
    // allowed to cross. They used to cross confusingly — a route called 'home'
    // rendering under a tab labelled "Explore" — because both were positional
    // words pointing opposite ways. `words` under "Home" is a mapping; `home`
    // under "Explore" was a riddle.
    expect(TABS.map((t) => t.id)).toEqual([
      'words', 'films', 'practice', 'lists', 'profile',
    ]);
  });

  it('never names a tab id after a position', () => {
    // The whole point of the rename. A positional id can be swapped with
    // another position, and was; a content id cannot be.
    const positional = ['home', 'explore'];
    for (const tab of TABS) {
      expect(positional).not.toContain(tab.id);
    }
  });

  it('gives the Home-labelled tab the house icon', () => {
    // The icon has to follow the label, not the route id, or the first cell
    // shows a compass under the word "Home".
    const first = TABS[0];
    expect(first.labelKey).toBe('home');
    expect(first.icon).toBe('home');
  });

  it('puts Lists fourth, before Profile', () => {
    expect(TABS.findIndex((t) => t.id === 'lists')).toBe(3);
    expect(TABS.findIndex((t) => t.id === 'lists'))
      .toBeLessThan(TABS.findIndex((t) => t.id === 'profile'));
  });

  it('gives every tab a distinct icon so none are ambiguous', () => {
    const icons = TABS.map((t) => t.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('labels', () => {
  it('registers `lists` in the namespace list', () => {
    expect(NAMESPACES).toContain('lists');
  });

  it.each(LOCALES)('%s translates every tab label', (locale) => {
    const nav = (resources[locale].common as { nav: Record<string, string> }).nav;
    for (const tab of TABS) {
      expect(nav[tab.labelKey]).toBeTruthy();
    }
  });

  it.each(LOCALES)('%s ships a real Lists label, not the English placeholder', (locale) => {
    const nav = (resources[locale].common as { nav: Record<string, string> }).nav;
    if (locale === 'en') return;
    // The tab bar shows every language on day one, so an untranslated label
    // is a visible bug rather than a TODO.
    expect(nav.lists).not.toBe('Lists');
  });

  it.each(LOCALES)('%s keeps every tab label inside its cell at 320pt', (locale) => {
    const nav = (resources[locale].common as { nav: Record<string, string> }).nav;
    for (const tab of TABS) {
      const label = nav[tab.labelKey];
      expect({ locale, label, fits: estimatedLabelWidth(label) <= CELL_WIDTH })
        .toEqual({ locale, label, fits: true });
    }
  });
});

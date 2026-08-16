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
  it('is Home · Explore · Practice · Lists · Profile', () => {
    expect(TABS.map((t) => t.id)).toEqual([
      'home', 'explore', 'practice', 'lists', 'profile',
    ]);
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

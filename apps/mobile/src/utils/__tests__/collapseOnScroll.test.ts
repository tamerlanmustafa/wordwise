import {
  nextCollapsed,
  WORD_CARD_COLLAPSE_ENTER,
  WORD_CARD_COLLAPSE_EXIT,
} from '../collapseOnScroll';

describe('nextCollapsed', () => {
  it('collapses once scrolled past the enter threshold', () => {
    expect(nextCollapsed(false, WORD_CARD_COLLAPSE_ENTER + 1)).toBe(true);
  });

  it('stays expanded while at or below the enter threshold', () => {
    expect(nextCollapsed(false, 0)).toBe(false);
    expect(nextCollapsed(false, WORD_CARD_COLLAPSE_ENTER)).toBe(false);
  });

  it('re-expands once scrolled back above the exit threshold', () => {
    expect(nextCollapsed(true, WORD_CARD_COLLAPSE_EXIT - 1)).toBe(false);
    expect(nextCollapsed(true, 0)).toBe(false);
  });

  it('stays collapsed while at or above the exit threshold', () => {
    expect(nextCollapsed(true, WORD_CARD_COLLAPSE_EXIT)).toBe(true);
    expect(nextCollapsed(true, 500)).toBe(true);
  });

  it('holds state in the dead-band between the thresholds (no flicker)', () => {
    const mid = (WORD_CARD_COLLAPSE_ENTER + WORD_CARD_COLLAPSE_EXIT) / 2;
    expect(nextCollapsed(false, mid)).toBe(false);
    expect(nextCollapsed(true, mid)).toBe(true);
  });
});

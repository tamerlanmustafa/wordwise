/**
 * `withAlpha` derives a ramp from one palette token instead of freezing a new
 * token per step — the Explore mix bar's six difficulty bands are one `gold`
 * at six opacities. That only works if it handles the shapes the palette
 * actually stores, and degrades to a solid colour rather than to garbage on
 * anything it doesn't recognise: a malformed colour string in React Native is
 * not a caught error, it's an invisible view.
 */
import { themes, withAlpha } from '../tokens';

describe('withAlpha', () => {
  it('expands the palette’s six-digit hex', () => {
    expect(withAlpha('#C58B1B', 0.42)).toBe('rgba(197,139,27,0.42)');
    expect(withAlpha('#FFD166', 1)).toBe('rgba(255,209,102,1)');
  });

  it('expands three-digit shorthand', () => {
    expect(withAlpha('#FFF', 0.5)).toBe('rgba(255,255,255,0.5)');
  });

  it('replaces the alpha on a colour that already has one', () => {
    expect(withAlpha('rgba(255,209,102,0.45)', 0.8)).toBe('rgba(255,209,102,0.8)');
    expect(withAlpha('rgb(10, 20, 30)', 0.25)).toBe('rgba(10,20,30,0.25)');
  });

  it('clamps to a legal opacity', () => {
    expect(withAlpha('#000000', 4)).toBe('rgba(0,0,0,1)');
    expect(withAlpha('#000000', -1)).toBe('rgba(0,0,0,0)');
  });

  it('hands back anything it cannot parse rather than mangling it', () => {
    expect(withAlpha('transparent', 0.5)).toBe('transparent');
    expect(withAlpha('#ab', 0.5)).toBe('#ab');
  });

  it('handles the gold token in both themes', () => {
    // The mix bar's ramp is built from exactly this, at render time — if
    // either theme's gold stops parsing, six segments go transparent.
    for (const theme of [themes.light, themes.dark]) {
      expect(withAlpha(theme.gold, 0.14)).toMatch(/^rgba\(\d+,\d+,\d+,0\.14\)$/);
    }
  });
});

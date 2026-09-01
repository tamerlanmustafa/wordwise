/**
 * `shade` is what makes a practice tile look like a lit 3D object: the face
 * gradient, the rim highlight and the extruded lip are all one palette token
 * at three lightnesses, derived at render time so the tiles follow the accent
 * instead of freezing a dozen hexes beside it.
 *
 * Same failure mode as `withAlpha`, and the same reason to test it: a
 * malformed colour string in React Native does not throw, it renders nothing.
 */
import { shade, themes } from '../tokens';

describe('shade', () => {
  it('lightens toward white by the given fraction', () => {
    expect(shade('#000000', 0.5)).toBe('rgb(128,128,128)');
    expect(shade('#808080', 1)).toBe('rgb(255,255,255)');
  });

  it('darkens toward black on a negative amount', () => {
    expect(shade('#FFFFFF', 0.5)).toBe('rgb(255,255,255)');
    expect(shade('#FFFFFF', -0.5)).toBe('rgb(128,128,128)');
    expect(shade('#808080', -1)).toBe('rgb(0,0,0)');
  });

  it('is the identity at zero', () => {
    expect(shade('#C58B1B', 0)).toBe('rgb(197,139,27)');
  });

  it('reads the shapes the palette stores', () => {
    expect(shade('#FFF', -1)).toBe('rgb(0,0,0)');
    expect(shade('rgb(10, 20, 30)', 0)).toBe('rgb(10,20,30)');
    // Alpha is dropped on purpose: a shaded colour is a solid tone, and the
    // callers that want transparency compose `withAlpha` on top.
    expect(shade('rgba(255,255,255,0.4)', -1)).toBe('rgb(0,0,0)');
  });

  it('clamps rather than overshooting past white or black', () => {
    expect(shade('#336699', 4)).toBe('rgb(255,255,255)');
    expect(shade('#336699', -4)).toBe('rgb(0,0,0)');
  });

  it('hands back anything it cannot parse rather than mangling it', () => {
    expect(shade('transparent', 0.5)).toBe('transparent');
    expect(shade('#ab', 0.5)).toBe('#ab');
  });

  it('derives a legible tile ramp from every node token in both themes', () => {
    // The tile face is shade(+0.22) over the token over shade(-0.12); if a
    // token stops parsing, a whole tile state renders as a flat blank circle.
    for (const theme of [themes.light, themes.dark]) {
      for (const token of [theme.gold, theme.nodeLocked, theme.error, theme.nodeGoldEdge]) {
        expect(shade(token, 0.22)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        expect(shade(token, -0.12)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      }
    }
  });
});

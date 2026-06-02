import { LEVEL_OPTIONS } from '../filterOptions';

describe('LEVEL_OPTIONS (CEFR level picker)', () => {
  it('lists exactly the six CEFR levels in ascending order', () => {
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('labels each level with its code as a prefix', () => {
    LEVEL_OPTIONS.forEach((o) => {
      expect(o.label.startsWith(o.value)).toBe(true);
    });
  });

  it('gives every option a non-empty difficulty icon', () => {
    LEVEL_OPTIONS.forEach((o) => {
      expect(o.icon.length).toBeGreaterThan(0);
    });
  });

  it('uses progressively "harder" icons (green → yellow/orange → red)', () => {
    const byValue = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.icon]));
    expect(byValue.A1).toBe('🟢');
    expect(byValue.A2).toBe('🟢');
    expect(byValue.C1).toBe('🔴');
    expect(byValue.C2).toBe('🔴');
  });
});

import { randomToken, shuffle } from '../random';

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input).sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate its input', () => {
    // Callers pass arrays that are already React state — reordering one in
    // place would change what is rendered without changing the reference.
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([7])).toEqual([7]);
  });

  it('actually reorders across repeated runs', () => {
    // 12! orderings, so 20 identical results would mean it is not shuffling
    // rather than being an unlucky run.
    const input = Array.from({ length: 12 }, (_, i) => i);
    const moved = Array.from({ length: 20 }, () => shuffle(input)).some(
      (out) => out.join() !== input.join(),
    );
    expect(moved).toBe(true);
  });
});

describe('randomToken', () => {
  it('mints a distinct token each call', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
  });

  it('stays inside the length the feed endpoint accepts', () => {
    // `GET /srs/feed` caps `seed` at 64 characters.
    expect(randomToken().length).toBeLessThanOrEqual(64);
  });

  it('is url-safe, since it travels as a query parameter', () => {
    expect(randomToken()).toMatch(/^[a-z0-9]+$/);
  });
});

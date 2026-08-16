/**
 * random — shuffling and token minting, kept pure so they can be tested and
 * reused rather than re-inlined per caller.
 *
 * Both exist for the Explore feed: it deals its cached cards in a new order
 * on every launch (`shuffle`) and asks the server for a new order too
 * (`randomToken`, sent as the feed's `seed`).
 */

/**
 * Fisher-Yates over a copy.
 *
 * Copying rather than shuffling in place matters: callers pass arrays that
 * are already React state, and mutating those would reorder a list without
 * telling React the reference changed.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A short opaque token — enough entropy to pick a different shuffle, not a
 * secret and never used as one.
 *
 * The timestamp half is not decoration: `Math.random()` is at its least
 * seeded in the first milliseconds of a cold JS context, which is exactly
 * when this is called. Mixing in the clock guarantees two launches differ
 * even if the PRNG hands back the same opening value.
 */
export function randomToken(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-6);
  return `${rand}${time}`;
}

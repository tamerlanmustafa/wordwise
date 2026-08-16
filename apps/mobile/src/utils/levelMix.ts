/**
 * levelMix — the arithmetic behind the Explore feed's CEFR mix.
 *
 * Pure on purpose: the store uses it to validate and persist, the mix panel
 * uses it to drive steppers, drag, and disabled states. Keeping the rules in
 * one place is what stops the slider and the server disagreeing about what
 * "70% B1" means.
 *
 * The invariant everywhere: each level moves independently, and the four
 * shares may never exceed 100. `+` and drag are clamped by what's left;
 * `−` always works down to 0. A mix that totals less than 100 is a legal
 * intermediate state (the panel shows "15% still to assign") — only
 * `isBalanced` mixes may be sent to the server.
 */

import type { LevelMix } from '../services/api';

/** Levels the feed can address, in CEFR order. A1 is out — the feed is a
 *  stretch surface and A1 lemmas are almost all function words. */
export const MIX_LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

export type MixLevel = (typeof MIX_LEVELS)[number];

/** Every control moves in 5% detents — finer than that is fiddly on a
 *  6px track and means nothing to a 20-card page. */
export const MIX_STEP = 5;

export const MIX_TOTAL = 100;

export function mixTotal(mix: LevelMix): number {
  return MIX_LEVELS.reduce((sum, level) => sum + (mix[level] ?? 0), 0);
}

export function isBalanced(mix: LevelMix): boolean {
  return mixTotal(mix) === MIX_TOTAL;
}

/** How much is still unassigned. Never negative. */
export function remainingToAssign(mix: LevelMix): number {
  return Math.max(0, MIX_TOTAL - mixTotal(mix));
}

/** The most-weighted level — the mix glyph's rail label. Ties break toward
 *  the lower CEFR level so the label doesn't flicker while dragging. */
export function dominantLevel(mix: LevelMix): MixLevel {
  let best: MixLevel = MIX_LEVELS[0];
  for (const level of MIX_LEVELS) {
    if ((mix[level] ?? 0) > (mix[best] ?? 0)) best = level;
  }
  return best;
}

function snap(value: number): number {
  return Math.round(value / MIX_STEP) * MIX_STEP;
}

/**
 * Set one level to `value`, snapped to 5% and clamped so the total can
 * never exceed 100. Other levels are left exactly as they are — we never
 * silently steal from a level the user already set.
 */
export function setLevel(mix: LevelMix, level: MixLevel, value: number): LevelMix {
  const others = mixTotal(mix) - (mix[level] ?? 0);
  const ceiling = Math.max(0, MIX_TOTAL - others);
  const next = Math.min(Math.max(snap(value), 0), ceiling);
  return { ...mix, [level]: next };
}

/** `+` — one detent up, clamped by what's left of 100. */
export function increment(mix: LevelMix, level: MixLevel): LevelMix {
  return setLevel(mix, level, (mix[level] ?? 0) + MIX_STEP);
}

/** `−` — one detent down, floored at 0. */
export function decrement(mix: LevelMix, level: MixLevel): LevelMix {
  return setLevel(mix, level, (mix[level] ?? 0) - MIX_STEP);
}

/** Whether `+` can move. False dims the glyph to textFaint. Level-independent
 *  — a level can grow whenever the mix as a whole has room. */
export function canIncrement(mix: LevelMix): boolean {
  return remainingToAssign(mix) >= MIX_STEP;
}

/** Whether `−` can move. */
export function canDecrement(mix: LevelMix, level: MixLevel): boolean {
  return (mix[level] ?? 0) > 0;
}

/** Drag position (0..1 of the track) → a snapped, clamped mix. */
export function setLevelFromFraction(
  mix: LevelMix,
  level: MixLevel,
  fraction: number,
): LevelMix {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return setLevel(mix, level, clamped * MIX_TOTAL);
}

/**
 * The first-run mix, sat on the user's onboarding level: their level takes
 * 70, one above 20, two above 10. Near the top of the scale the band runs
 * out of room, so the overflow folds back onto the levels that exist —
 * a C1 user gets everything on C1 rather than a mix that sums to 70.
 */
export function defaultMixForLevel(level: string | null | undefined): LevelMix {
  const weights = [70, 20, 10];
  const start = MIX_LEVELS.indexOf((level ?? '').toUpperCase() as MixLevel);
  // Unknown or sub-A2 levels (A1, or a level we don't address) start at B1,
  // the most common band.
  const base = start >= 0 ? start : MIX_LEVELS.indexOf('B1');

  const mix: LevelMix = {};
  for (const l of MIX_LEVELS) mix[l] = 0;

  let overflow = 0;
  weights.forEach((weight, offset) => {
    const target = MIX_LEVELS[base + offset];
    if (target) mix[target] += weight;
    else overflow += weight;
  });

  // Fold what fell off the top back onto the highest addressable level.
  if (overflow > 0) mix[MIX_LEVELS[MIX_LEVELS.length - 1]] += overflow;

  return mix;
}

/** Guard for anything read back from storage or handed to the server. */
export function isValidMix(mix: unknown): mix is LevelMix {
  if (!mix || typeof mix !== 'object') return false;
  const entries = Object.entries(mix as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [level, value] of entries) {
    if (!MIX_LEVELS.includes(level as MixLevel)) return false;
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (value < 0 || value > MIX_TOTAL) return false;
  }
  return isBalanced(mix as LevelMix);
}

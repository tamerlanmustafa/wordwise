/**
 * levelMix — the arithmetic behind the Explore feed's CEFR mix.
 *
 * Pure on purpose: the store uses it to validate and persist, the mix panel
 * uses it to drive the composition bar. Keeping the rules in one place is what
 * stops the panel and the server disagreeing about what "70% B1" means.
 *
 * The shape that matters: the panel's state is an ordered array of **cut
 * points** on a single 0–100 bar, and the per-level shares are *derived* from
 * the cuts (`share[i] = cut[i] − cut[i−1]`). Because a cut can only move along
 * the bar, there is no arrangement of cuts whose shares fail to total 100 —
 * so 100% is a property of the control's geometry rather than a rule the user
 * has to satisfy. That is why there is no "15% still to assign" state, no
 * redistribution pass, and no disabled Done.
 *
 * `LevelMix` stays the wire/storage shape (`Record<string, number>`) because
 * the API and AsyncStorage already speak it. Cuts never leave the panel.
 */

import type { LevelMix } from '../services/api';

/** Levels the feed can address, in CEFR order — the full CEFR range. The mix
 *  is a composition bar over all six, so the feed can be dialled anywhere from
 *  A1 to C2. */
export const MIX_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export type MixLevel = (typeof MIX_LEVELS)[number];

/**
 * The bar's own resolution: dragging commits whole percents.
 *
 * There are deliberately **two** steps here, because a drag and a tap are
 * asking different questions. A drag is aiming — the finger is already on the
 * exact spot it wants, and a coarse detent fights it. On a bar a phone wide 1%
 * is ~3.3pt, fine enough that the divider tracks the finger and coarse enough
 * that nothing but integers ever reach the wire (the server parses shares with
 * `int()`, so floats must not leak out of the panel).
 */
export const MIX_STEP = 1;

/**
 * What one *tap* is worth — the legend chip, VoiceOver's increment, and the
 * floor under "did the user really ask for this level?".
 *
 * 5 because a page is 20 cards and 100/5 = 20, so one tap is exactly one card
 * of the next page: tap B1 once and the page provably comes back with one more
 * B1 in it. A tap has no aim of its own, so it should be worth something you
 * can see; that is precisely one card. Kept independent of MIX_STEP so making
 * the drag finer never quietly makes the tap useless.
 */
export const MIX_NUDGE_STEP = 5;

export const MIX_TOTAL = 100;

/** N levels → N−1 cuts, non-decreasing, each a multiple of MIX_STEP. */
export type MixCuts = number[];

/** How many cuts a full bar has. */
export const MIX_CUT_COUNT = MIX_LEVELS.length - 1;

export function mixTotal(mix: LevelMix): number {
  return MIX_LEVELS.reduce((sum, level) => sum + (mix[level] ?? 0), 0);
}

/** Wire/storage guard only — the panel can no longer produce anything else. */
export function isBalanced(mix: LevelMix): boolean {
  return mixTotal(mix) === MIX_TOTAL;
}

function snap(value: number): number {
  return Math.round(value / MIX_STEP) * MIX_STEP;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Clamp to the bar and put the cuts back in order. Every producer here
 *  already returns ordered cuts; this is what makes `cutsToMix`'s "always
 *  totals 100" claim hold for hand-built input too. */
function orderCuts(cuts: MixCuts): MixCuts {
  return cuts
    .slice(0, MIX_CUT_COUNT)
    .map((c) => (Number.isFinite(c) ? clamp(c, 0, MIX_TOTAL) : 0))
    .sort((a, b) => a - b);
}

/** Shares → cuts: the running sum, dropping the last (which is always 100). */
function sharesToCuts(shares: number[]): MixCuts {
  const cuts: MixCuts = [];
  let running = 0;
  for (let i = 0; i < MIX_CUT_COUNT; i++) {
    running += shares[i] ?? 0;
    cuts.push(running);
  }
  return cuts;
}

/**
 * Cuts → the wire shape. `share[0] = cuts[0]`, `share[i] = cuts[i] − cuts[i−1]`,
 * and the last level takes whatever is left of 100 — so the result totals
 * exactly 100 for *any* input, which is the whole point of the control.
 */
export function cutsToMix(cuts: MixCuts): LevelMix {
  const ordered = orderCuts(cuts);
  const mix: LevelMix = {};
  let prev = 0;
  MIX_LEVELS.forEach((level, i) => {
    // The last level has no cut of its own — it runs to the end of the bar.
    const edge = i === MIX_CUT_COUNT ? MIX_TOTAL : (ordered[i] ?? prev);
    mix[level] = edge - prev;
    prev = edge;
  });
  return mix;
}

/**
 * Six shares, snapped to MIX_STEP and totalling exactly 100.
 *
 * Tolerant by design — this is the migration path for mixes already on disk.
 * A four-level mix arrives with A1/C2 missing (read as 0) and passes straight
 * through; a mix that totals 85 (the old panel's legal-but-unsendable state)
 * is scaled to 100 and snapped with largest-remainder, so its *shape* is kept
 * rather than being thrown away for the default.
 */
function normalizeShares(mix: LevelMix): number[] {
  const raw = MIX_LEVELS.map((level) => {
    const value = mix?.[level];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  });
  const total = raw.reduce((sum, v) => sum + v, 0);

  // Nothing usable in there at all — an empty object, or every level at 0.
  if (total <= 0) return MIX_LEVELS.map((level) => defaultMixForLevel(null)[level] ?? 0);

  if (total === MIX_TOTAL && raw.every((v) => v % MIX_STEP === 0)) return raw;

  // Largest-remainder apportionment in whole detents: floor everything, then
  // hand the leftover units to whoever lost most to rounding.
  const units = MIX_TOTAL / MIX_STEP;
  const exact = raw.map((v) => (v / total) * units);
  const whole = exact.map((v) => Math.floor(v));
  let leftover = units - whole.reduce((sum, v) => sum + v, 0);
  const byRemainder = whole
    .map((_, i) => i)
    .sort((a, b) => exact[b] - whole[b] - (exact[a] - whole[a]) || a - b);
  for (let k = 0; leftover > 0; k++, leftover--) {
    whole[byRemainder[k % byRemainder.length]] += 1;
  }
  return whole.map((v) => v * MIX_STEP);
}

/** The wire shape → cuts, for the panel to open on. */
export function mixToCuts(mix: LevelMix): MixCuts {
  return sharesToCuts(normalizeShares(mix));
}

/**
 * Drag one divider to `valuePct` and let it **push** its neighbours.
 *
 * Pushing rather than stopping is what makes 0% and 100% reachable: a divider
 * dragged to either end sweeps the collapsed stack along with it, so the level
 * on the far side is squeezed out entirely instead of the drag jamming against
 * the cut next door.
 */
export function moveCut(cuts: MixCuts, index: number, valuePct: number): MixCuts {
  const next = orderCuts(cuts);
  if (index < 0 || index >= next.length) return next;

  const v = clamp(snap(Number.isFinite(valuePct) ? valuePct : 0), 0, MIX_TOTAL);
  next[index] = v;
  for (let j = index - 1; j >= 0; j--) next[j] = Math.min(next[j], v);
  for (let j = index + 1; j < next.length; j++) next[j] = Math.max(next[j], v);
  return next;
}

/**
 * Move `delta` into one level, taken from the largest of the others — the
 * legend chip's tap, and the only comfortable way to reopen a level sitting
 * at 0%. A negative `delta` runs the trade the other way (VoiceOver's
 * "decrement").
 *
 * Ties break toward the *higher* CEFR level, so nudging A1 does not keep
 * gutting B1 while B2 sits at the same share.
 */
export function nudge(cuts: MixCuts, levelIndex: number, delta: number = MIX_NUDGE_STEP): MixCuts {
  const ordered = orderCuts(cuts);
  const mix = cutsToMix(ordered);
  const shares = MIX_LEVELS.map((level) => mix[level] ?? 0);

  if (levelIndex < 0 || levelIndex >= shares.length) return ordered;
  const step = snap(Math.abs(delta));
  if (step <= 0) return ordered;

  let other = -1;
  for (let i = 0; i < shares.length; i++) {
    if (i === levelIndex) continue;
    // `>=` walks up to the highest index among equal maxima.
    if (other === -1 || shares[i] >= shares[other]) other = i;
  }
  if (other === -1) return ordered;

  const from = delta >= 0 ? other : levelIndex;
  const to = delta >= 0 ? levelIndex : other;
  // Nobody has a detent to give — a level already holding 100 can't grow.
  if (shares[from] < step) return ordered;

  shares[from] -= step;
  shares[to] += step;
  return sharesToCuts(shares);
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

/**
 * The first-run mix, sat on the user's onboarding level: their level takes
 * 70, one above 20, two above 10. Near the top of the scale the band runs
 * out of room, so the overflow folds back onto the levels that exist —
 * a C2 user gets everything on C2 rather than a mix that sums to 70.
 */
export function defaultMixForLevel(level: string | null | undefined): LevelMix {
  const weights = [70, 20, 10];
  const start = MIX_LEVELS.indexOf((level ?? '').toUpperCase() as MixLevel);
  // A level we don't recognise starts at B1, the most common band.
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

/**
 * Do these two mixes mean the same thing?
 *
 * Compared over MIX_LEVELS with a missing level read as 0, which is the whole
 * reason this isn't a deep-equal at the call site: a mix restored from the
 * previous build is `{A2,B1,B2,C1}` while the panel always emits all six, so
 * `{B1:70,B2:20,C1:10}` and `{A1:0,…,C2:0}` are structurally different objects
 * that describe an identical feed. Anything keying off "did the mix change"
 * would otherwise fire on every Done for exactly the users who never changed
 * anything.
 */
export function sameMix(a: LevelMix, b: LevelMix): boolean {
  return MIX_LEVELS.every((level) => (a?.[level] ?? 0) === (b?.[level] ?? 0));
}

/** Guard for anything read back from storage or handed to the server. The UI
 *  is never gated on this — the bar cannot build an unbalanced mix. */
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

export interface LevelCount {
  level: MixLevel;
  count: number;
}

/**
 * How the next page of `pageSize` cards splits across the levels — the same
 * largest-remainder apportionment the server runs, so the footer's read-out is
 * the page the user is about to get rather than a rounded-off guess.
 *
 * Levels at 0 are dropped: the footer names where cards come from, and "0 A1"
 * is noise. The counts always sum to `pageSize` when there is stock for them.
 */
export function pageCounts(mix: LevelMix, pageSize: number): LevelCount[] {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return [];

  const wanted = MIX_LEVELS.filter((level) => (mix[level] ?? 0) > 0);
  if (wanted.length === 0) return [];

  // Divide by the mix's own total rather than 100, so a mix that somehow
  // arrives unbalanced still apportions the whole page instead of a fraction.
  const total = wanted.reduce((sum, level) => sum + (mix[level] ?? 0), 0);
  const exact = wanted.map((level) => ((mix[level] ?? 0) / total) * pageSize);
  const counts = exact.map((v) => Math.floor(v));

  let leftover = pageSize - counts.reduce((sum, n) => sum + n, 0);
  const byRemainder = counts
    .map((_, i) => i)
    .sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || a - b);
  for (let k = 0; leftover > 0; k++, leftover--) {
    counts[byRemainder[k % byRemainder.length]] += 1;
  }

  return wanted
    .map((level, i) => ({ level, count: counts[i] }))
    .filter((entry) => entry.count > 0);
}

export interface MixShortfall {
  /** The level the user asked for that came back with nothing. */
  short: MixLevel;
  /** Where the page actually drew from instead. */
  from: MixLevel;
}

/**
 * A level the user asked for that the pool could not serve — the one line of
 * truth under the legend.
 *
 * Reads `mix_applied` from the last real page, so it can only fire after the
 * server has actually answered: an empty `applied` means "no page yet", not
 * "everything is empty". One level, the largest shortfall, or nothing.
 */
export function mixShortfall(requested: LevelMix, applied: LevelMix): MixShortfall | null {
  const served = MIX_LEVELS.filter((level) => (applied[level] ?? 0) > 0);
  if (served.length === 0) return null;

  let short: MixLevel | null = null;
  for (const level of MIX_LEVELS) {
    // Below one *tap* the user did not really ask for the level. Deliberately
    // MIX_NUDGE_STEP and not MIX_STEP: at 1% this would fire the "running low"
    // note for a share worth a fifth of a card, which is noise, not truth.
    if ((requested[level] ?? 0) < MIX_NUDGE_STEP) continue;
    if ((applied[level] ?? 0) > 0) continue;
    if (short === null || (requested[level] ?? 0) > (requested[short] ?? 0)) short = level;
  }
  if (short === null) return null;

  const from = served.reduce((best, level) =>
    (applied[level] ?? 0) > (applied[best] ?? 0) ? level : best,
  );
  return { short, from };
}

/**
 * cefrRamp — one colour per CEFR band, gold at A1 running to red at C2.
 *
 * The colour means *difficulty*, and only difficulty. That is the whole point:
 * a band's colour is a property of the band, so the same A2 is the same colour
 * on every film, and the bar and its legend cannot disagree because they read
 * the same function.
 *
 * The vocabulary sheet's bar used to be shaded gold-if-within-your-level,
 * grey-if-above — colour meaning "you" rather than "the word". That is a
 * defensible thing to show, but it makes a band's colour depend on who is
 * looking, so the same segment is gold on one account and grey on another and
 * neither the bar nor the legend can be read on its own.
 *
 * ## This is the only band palette
 *
 * There were three. `theme/palette.ts` ran green→purple, a dead `theme/index.ts`
 * ran green→red, and this ramp drew the vocabulary sheet's bar — and the first
 * two disagreed with each other about what colour C2 is while both being
 * exported as `cefrColors`. `theme/index.ts` is gone and `palette.ts` now
 * derives its two maps from this file, so a band has one definition.
 *
 * Built from the accent *tokens* rather than frozen hexes, so it follows the
 * palette into light mode, dark mode, and whatever the accent becomes next.
 * If you need band colours somewhere new, project them from here — do not
 * write a fourth set.
 */

import { CEFR_LEVELS } from '../types/constants';
import { mix, type ThemeColors } from './tokens';

/**
 * The six band colours, easiest first, interpolated between the two endpoints.
 *
 * Linear across the band *index* rather than across any measure of real
 * difficulty. The bands are ordinal — the gap from B2 to C1 is not a known
 * multiple of the gap from A1 to A2 — so an even spread is the only spacing
 * that does not invent a precision the scale does not have.
 */
export function cefrRamp(from: string, to: string): string[] {
  const last = CEFR_LEVELS.length - 1;
  return CEFR_LEVELS.map((_, i) => mix(from, to, i / last));
}

/** The ramp for a theme: gold through to the theme's own red. */
export function cefrRampFor(tc: ThemeColors): string[] {
  return cefrRamp(tc.gold, tc.error);
}

/**
 * One band's colour. Falls back to the easiest end for a code off the scale —
 * `dist` payloads carry an UNKNOWN bucket (see issue #91), and an unreadable
 * segment is worse than a slightly wrong one.
 */
export function cefrColorFor(level: string, ramp: string[]): string {
  const i = CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]);
  return i === -1 ? ramp[0] : ramp[i];
}

/**
 * Static colour palette — light-mode values, plus CEFR-level colours that
 * are theme-independent (the same green = A1 in both modes).
 *
 * For colours that must change with the active theme, use
 * `useThemeColors()` from ./tokens instead — this file's `colors` is just a
 * static snapshot of the light palette for places that can't run a hook
 * (e.g. StyleSheet.create blocks at module scope).
 */

export const colors = {
  primary: '#7C5CBF',
  primaryLight: '#9B7ED9',
  secondary: '#E07A5F',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  border: '#E8E8EC',
  success: '#4CAF9A',
  warning: '#F4A261',
  error: '#D66A6A',
} as const;

/**
 * The CEFR band colours, for every surface in the app that shows a level.
 *
 * These are **projections of `theme/cefrRamp`, not a palette of their own.**
 * There were three sets of band colours in this codebase — one here running
 * green→purple, one in a dead `theme/index.ts` running green→red, and the ramp
 * the vocabulary sheet draws its bar with — and the first two disagreed with
 * each other about what colour C2 is while both being exported as
 * `cefrColors`. The dead one is deleted. A level is one of the few things in
 * this app that means the same thing on every screen, so it now has one
 * definition and these are two renderings of it.
 *
 * `cefrColors` is the vivid rendering, from the dark theme's accents: it is
 * used as a fill and as text on dark ground, where a muted colour disappears.
 * `cefrColorsDark` is the same ramp from the light theme's accents, which are
 * already darkened for contrast — that is what the name has always meant here
 * (text and selected chips *on a light surface*), not "the dark mode set".
 *
 * Prefer `cefrRampFor(useThemeColors())` in anything that can run a hook: it
 * follows the active theme instead of committing to one of these two. These
 * exist for module-scope StyleSheet blocks and other places a hook cannot go.
 */

import { cefrRamp } from './cefrRamp';
import { themes } from './tokens';
import { CEFR_LEVELS } from '../types/constants';

function rampMap(from: string, to: string): Record<string, string> {
  const ramp = cefrRamp(from, to);
  return Object.fromEntries(CEFR_LEVELS.map((code, i) => [code, ramp[i]]));
}

export const cefrColors: Record<string, string> = rampMap(
  themes.dark.gold,
  themes.dark.error,
);

export const cefrColorsDark: Record<string, string> = rampMap(
  themes.light.gold,
  themes.light.error,
);


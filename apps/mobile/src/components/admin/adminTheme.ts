/**
 * Shared palette for the admin surfaces (AdminScreen + its health views).
 *
 * **This used to be a fixed light-only palette** with a docblock explaining
 * that admin "predates the app's theme tokens". That was true and it still
 * rendered a full-screen white slab in front of anyone using the app in dark
 * mode — the one screen you open at night to check whether something is on
 * fire. It now derives from `useThemeColors()` like everything else.
 *
 * The key names are unchanged so the six files that read `COLORS.*` keep
 * working; what changed is that they read it from a hook instead of a module
 * constant, which is the whole reason each of those files now builds its
 * styles through `makeStyles(c)` rather than at module scope.
 *
 * The status tokens stay hand-picked rather than derived. They encode meaning
 * (healthy / worth watching / needs attention), not brand, and a red that
 * shifts with the accent colour is a red that eventually stops reading as an
 * alarm. They do get per-scheme values, because the light-mode tints fail
 * contrast on a dark ground.
 */

import { useMemo } from 'react';
import { useColorScheme, useThemeColors, withAlpha } from '../../theme/tokens';

export interface AdminColors {
  primary: string;
  background: string;
  paper: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  overlay: string;
  /** One step off `paper` — nested rows inside an already-raised card. */
  inset: string;
}

/**
 * The admin palette for the active theme.
 *
 * Call it once per component and feed the result to that component's
 * `makeStyles`; `useMemo` on the returned object keeps the StyleSheet stable
 * between renders.
 */
export function useAdminColors(): AdminColors {
  const tc = useThemeColors();
  const scheme = useColorScheme();

  return useMemo(
    () => ({
      primary: tc.primaryOnSurface,
      background: tc.background,
      paper: tc.paper,
      text: tc.text,
      textSecondary: tc.textSecondary,
      textTertiary: tc.textFaint,
      border: tc.border,
      success: scheme === 'dark' ? '#5FD0B4' : '#2E7D6B',
      warning: scheme === 'dark' ? '#F0B36B' : '#A65F1E',
      error: scheme === 'dark' ? '#E88C8C' : '#A63F3F',
      info: scheme === 'dark' ? '#7FB2F0' : '#2C6BB5',
      overlay: 'rgba(0, 0, 0, 0.55)',
      inset: tc.chipBg,
    }),
    [tc, scheme],
  );
}

export type StatusKey = 'ok' | 'warn' | 'fail';

export interface StatusToken {
  /** Saturated fill for thin marks (meter fills, chart segments). */
  mark: string;
  /** Tinted chip background with matching ink — see the note below. */
  chipBg: string;
  chipInk: string;
}

/**
 * Status tokens per scheme.
 *
 * `mark` is used for thin marks and is never the only signal: every mark is
 * paired with a text label and the value is always printed, which is what
 * keeps the report readable for anyone who cannot separate the three hues.
 *
 * `chipBg`/`chipInk` are a tint plus matching ink rather than white-on-fill,
 * because white on the saturated warning and success fills reaches only ~2:1
 * and fails text contrast in either scheme.
 */
export function useStatusTokens(): Record<StatusKey, StatusToken> {
  const scheme = useColorScheme();
  return useMemo(
    () =>
      scheme === 'dark'
        ? {
            ok: { mark: '#5FD0B4', chipBg: withAlpha('#5FD0B4', 0.16), chipInk: '#7FE0C6' },
            warn: { mark: '#F0B36B', chipBg: withAlpha('#F0B36B', 0.16), chipInk: '#F5C68E' },
            fail: { mark: '#E88C8C', chipBg: withAlpha('#E88C8C', 0.16), chipInk: '#F0A8A8' },
          }
        : {
            ok: { mark: '#4CAF9A', chipBg: '#E8F5F1', chipInk: '#2E7D6B' },
            warn: { mark: '#F4A261', chipBg: '#FDF0E2', chipInk: '#A65F1E' },
            fail: { mark: '#D66A6A', chipBg: '#FBEAEA', chipInk: '#A63F3F' },
          },
    [scheme],
  );
}

export const STATUS_LABEL: Record<StatusKey, string> = {
  ok: 'OK',
  warn: 'Warn',
  fail: 'Fail',
};

/** Plain-language gloss of what each status means, for the overview legend. */
export const STATUS_MEANING: Record<StatusKey, string> = {
  ok: 'Healthy',
  warn: 'Worth watching',
  fail: 'Needs attention',
};

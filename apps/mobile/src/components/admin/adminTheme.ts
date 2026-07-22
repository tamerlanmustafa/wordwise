/**
 * Shared palette for the admin surfaces (AdminScreen + the vocab-coverage view).
 *
 * Admin is a light-only internal tool and predates the app's theme tokens, so it
 * keeps its own fixed palette rather than pulling `useThemeColors`. Lives here so
 * the screen and its sub-views can't drift apart.
 */

export const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  success: '#4CAF9A',
  warning: '#F4A261',
  error: '#D66A6A',
  info: '#4A90E2',
  overlay: 'rgba(0, 0, 0, 0.45)',
};

export type StatusKey = 'ok' | 'warn' | 'fail';

/**
 * Status tokens for the coverage view.
 *
 * `mark` is the saturated fill used for thin marks (meter fills, segments). Those
 * sit below 3:1 against white, so they are never the only signal — every mark is
 * paired with a text label and the value is always printed.
 *
 * `chipBg`/`chipInk` are a tinted background with dark matching ink: white text on
 * the saturated warning/success fills only reaches ~2:1, which fails text
 * contrast, so chips use the tint pair instead.
 */
export const STATUS_TOKENS: Record<StatusKey, { mark: string; chipBg: string; chipInk: string }> = {
  ok: { mark: COLORS.success, chipBg: '#E8F5F1', chipInk: '#2E7D6B' },
  warn: { mark: COLORS.warning, chipBg: '#FDF0E2', chipInk: '#A65F1E' },
  fail: { mark: COLORS.error, chipBg: '#FBEAEA', chipInk: '#A63F3F' },
};

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

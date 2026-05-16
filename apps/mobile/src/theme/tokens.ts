/**
 * Theme tokens — the SINGLE source of truth for app colours.
 *
 * Import { useThemeColors } in components — it returns the right palette for
 * the current theme (light, dark, or system-driven). Components that read
 * static `colors` from ../theme/palette only see the light values; use this
 * hook instead so screens flip when the user toggles the theme in the menu.
 *
 * Adding a new colour: add it to BOTH `light` and `dark` below and to the
 * `ThemeColors` interface. Then read it via `tc.<name>` in components.
 */

import { useThemeStore } from '../stores/themeStore';

// ── Light theme ───────────────────────────────────────────────────────────────
const light = {
  primary:        '#7C5CBF',
  primaryLight:   '#9B7ED9',
  secondary:      '#E07A5F',
  background:     '#EDE8F5',
  paper:          '#FFFFFF',
  // A subtly elevated surface used for cards/tiles. Always lighter than
  // `background` in light, darker than `background` in dark.
  surface:        '#FFFFFF',
  text:           '#2D3142',
  textSecondary:  '#5C6378',
  textMuted:      '#9AA0AE',
  border:         '#E0D4F7',
  divider:        '#E8E8EC',
  success:        '#4CAF9A',
  warning:        '#F4A261',
  error:          '#D66A6A',
  bottomBarBg:    '#F3EEFF',
  bottomBarBorder:'#E0D4F7',
  scrim:          'rgba(0,0,0,0.4)',
} as const;

// ── Dark theme ────────────────────────────────────────────────────────────────
const dark = {
  primary:        '#9B7ED9',
  primaryLight:   '#B8A0E8',
  secondary:      '#E07A5F',
  background:     '#0F0F1A',
  paper:          '#1A1A2A',
  surface:        '#1F1F30',
  text:           '#F0F0F8',
  textSecondary:  '#A8A8C0',
  textMuted:      '#6E6E88',
  border:         '#2A2A3A',
  divider:        '#26263A',
  success:        '#4CAF9A',
  warning:        '#F4A261',
  error:          '#E57373',
  bottomBarBg:    '#1E1E2E',
  bottomBarBorder:'#2A2A3A',
  scrim:          'rgba(0,0,0,0.6)',
} as const;

export interface ThemeColors {
  primary: string;
  primaryLight: string;
  secondary: string;
  background: string;
  paper: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  divider: string;
  success: string;
  warning: string;
  error: string;
  bottomBarBg: string;
  bottomBarBorder: string;
  scrim: string;
}

export const themes: Record<'light' | 'dark', ThemeColors> = { light, dark };

/** Hook — returns the correct colour set for the current theme. */
export function useThemeColors(): ThemeColors {
  const resolved = useThemeStore((s) => s.resolved);
  return themes[resolved];
}

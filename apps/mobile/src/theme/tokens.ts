/**
 * Theme tokens — light and dark colour sets.
 * Import `useThemeColors()` in components instead of the raw `colors` object
 * so they respond to theme changes.
 */

import { useThemeStore } from '../stores/themeStore';

// ── Light theme ───────────────────────────────────────────────────────────────
const light = {
  primary:       '#7C5CBF',
  primaryLight:  '#9B7ED9',
  secondary:     '#E07A5F',
  background:    '#EDE8F5',   // light purple — the new home screen background
  paper:         '#FFFFFF',
  text:          '#2D3142',
  textSecondary: '#5C6378',
  border:        '#E0D4F7',
  success:       '#4CAF9A',
  warning:       '#F4A261',
  error:         '#D66A6A',
  bottomBarBg:   '#F3EEFF',
  bottomBarBorder:'#E0D4F7',
} as const;

// ── Dark theme ────────────────────────────────────────────────────────────────
const dark = {
  primary:       '#9B7ED9',
  primaryLight:  '#B8A0E8',
  secondary:     '#E07A5F',
  background:    '#0F0F1A',
  paper:         '#1A1A2A',
  text:          '#F0F0F8',
  textSecondary: '#8A8AA8',
  border:        '#2A2A3A',
  success:       '#4CAF9A',
  warning:       '#F4A261',
  error:         '#E57373',
  bottomBarBg:   '#1E1E2E',
  bottomBarBorder:'#2A2A3A',
} as const;

export interface ThemeColors {
  primary: string;
  primaryLight: string;
  secondary: string;
  background: string;
  paper: string;
  text: string;
  textSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  bottomBarBg: string;
  bottomBarBorder: string;
}

export const themes: Record<'light' | 'dark', ThemeColors> = { light, dark };

/** Hook — returns the correct colour set for the current theme. */
export function useThemeColors(): ThemeColors {
  const resolved = useThemeStore((s) => s.resolved);
  return themes[resolved];
}

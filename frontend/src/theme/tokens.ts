/**
 * Web design tokens — single source of truth for the redesign palette.
 *
 * Keys mirror the mobile app (apps/mobile/src/theme/tokens.ts) and the
 * design templates in web/shell.jsx so the brand language stays in sync
 * across platforms. Sidebar is always-dark even in light mode (cinema-
 * lobby treatment).
 *
 * Usage:
 *
 *   import { useThemeColors } from '@/theme/tokens';
 *   const t = useThemeColors();
 *   <div style={{ background: t.bg, color: t.text }} />
 *
 * Reads the mode from the existing ThemeContext (light/dark toggle on
 * localStorage), so flipping the theme flips these tokens too.
 */

import { useTheme } from '../contexts/ThemeContext';

export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  // Surfaces
  bg: string;
  bgRaised: string;
  paper: string;
  surface: string;
  raised: string;
  border: string;
  divider: string;

  // Text
  text: string;
  text2: string;
  text3: string;

  // Primary (soft purple)
  primary: string;
  primaryT: string;

  // Gold accent — preserved across modes; only the on-surface variant darkens.
  gold: string;
  goldOnSurface: string;
  goldDeep: string;

  // States
  success: string;
  successTint: string;
  successBorder: string;
  error: string;
  errorTint: string;
  errorBorder: string;

  // Chips
  chipBg: string;
  chipBgOn: string;
  chipTxtOn: string;

  // Sidebar (always-dark — feels like a cinema lobby)
  sidebarBg: string;
  sidebarBorder: string;

  // Interaction
  hover: string;

  // Shadows / glows
  shadowCard: string;
  heroGlow: string;
  lessonRing: string;
  shadowNode: string;
  shadowNodeLocked: string;

  // Journey nodes
  nodeLocked: string;
  nodeLockedB: string;

  // Quiz
  wordBox: string;
}

const dark: ThemeTokens = {
  bg: '#0e0d10',
  bgRaised: '#15141a',
  paper: '#1a1a24',
  surface: '#1F1F30',
  raised: '#23223a',
  border: 'rgba(255,255,255,0.10)',
  divider: 'rgba(255,255,255,0.06)',
  text: '#ffffff',
  text2: 'rgba(255,255,255,0.72)',
  text3: 'rgba(255,255,255,0.45)',
  primary: '#9B7ED9',
  primaryT: 'rgba(124,92,191,0.20)',
  gold: '#FFD166',
  goldOnSurface: '#FFD166',
  goldDeep: '#3a2400',
  success: '#4CAF9A',
  successTint: 'rgba(76,175,154,0.20)',
  successBorder: 'rgba(76,175,154,0.55)',
  error: '#E57373',
  errorTint: 'rgba(229,115,115,0.18)',
  errorBorder: 'rgba(229,115,115,0.55)',
  chipBg: 'rgba(255,255,255,0.06)',
  chipBgOn: '#FFD166',
  chipTxtOn: '#3a2400',
  sidebarBg: '#08070a',
  sidebarBorder: 'rgba(255,255,255,0.06)',
  hover: 'rgba(255,255,255,0.06)',
  shadowCard:
    '0 1px 0 rgba(255,255,255,0.03) inset, 0 10px 24px rgba(0,0,0,0.45)',
  heroGlow:
    'radial-gradient(60% 100% at 50% 0%, rgba(255,209,102,0.16) 0%, transparent 70%)',
  lessonRing: 'rgba(255,209,102,0.45)',
  shadowNode:
    '0 6px 0 rgba(0,0,0,0.45), 0 14px 24px rgba(255,209,102,0.18)',
  shadowNodeLocked: '0 4px 0 rgba(0,0,0,0.40)',
  nodeLocked: '#2a2935',
  nodeLockedB: 'rgba(255,255,255,0.06)',
  wordBox: '#0a090d',
};

const light: ThemeTokens = {
  bg: '#F4EFE3',
  bgRaised: '#FAF6E8',
  paper: '#FFFFFF',
  surface: '#FFFFFF',
  raised: '#FFFFFF',
  border: '#E5DCC4',
  divider: '#EEE6D2',
  text: '#2D2418',
  text2: '#6E5F47',
  text3: '#9C8E72',
  primary: '#7C5CBF',
  primaryT: 'rgba(124,92,191,0.10)',
  gold: '#C58B1B',
  goldOnSurface: '#8B5A00',
  goldDeep: '#3a2400',
  success: '#3F8B7B',
  successTint: 'rgba(63,139,123,0.14)',
  successBorder: 'rgba(63,139,123,0.55)',
  error: '#D66A6A',
  errorTint: 'rgba(214,106,106,0.16)',
  errorBorder: 'rgba(214,106,106,0.55)',
  chipBg: '#EEE6D2',
  chipBgOn: '#2D2418',
  chipTxtOn: '#FFD166',
  // Sidebar stays dark even in light mode (cinema-lobby treatment).
  sidebarBg: '#1E1612',
  sidebarBorder: 'rgba(255,255,255,0.08)',
  hover: 'rgba(58,36,0,0.06)',
  shadowCard:
    '0 1px 0 rgba(255,255,255,0.8) inset, 0 6px 14px rgba(60,40,10,0.10)',
  heroGlow:
    'radial-gradient(60% 100% at 50% 0%, rgba(197,139,27,0.12) 0%, transparent 70%)',
  lessonRing: 'rgba(197,139,27,0.55)',
  shadowNode:
    '0 5px 0 rgba(58,36,0,0.20), 0 10px 18px rgba(197,139,27,0.25)',
  shadowNodeLocked: '0 4px 0 rgba(58,36,0,0.10)',
  nodeLocked: '#E5DCC4',
  nodeLockedB: '#D7CCB0',
  wordBox: '#FAF7EE',
};

export const WW_TOKENS: Record<ThemeMode, ThemeTokens> = { dark, light };

/** CEFR level → swatch. Same across light/dark. */
export const CEFR: Record<string, string> = {
  A1: '#4CAF50',
  A2: '#8BC34A',
  B1: '#FFC107',
  B2: '#FF9800',
  C1: '#F44336',
  C2: '#9C27B0',
};

export const SERIF = `'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif`;
export const SANS = `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', system-ui, sans-serif`;
export const MONO = `'JetBrains Mono', 'SF Mono', Menlo, monospace`;

/** TMDB image helpers — same w300/w500 sizes the mobile app uses. */
export const TMDB = (p: string | null | undefined): string | null =>
  p ? `https://image.tmdb.org/t/p/w300${p}` : null;
export const TMDB_BIG = (p: string | null | undefined): string | null =>
  p ? `https://image.tmdb.org/t/p/w500${p}` : null;

/** Returns the active token set based on the current theme mode. */
export function useThemeColors(): ThemeTokens {
  const { mode } = useTheme();
  return WW_TOKENS[mode];
}

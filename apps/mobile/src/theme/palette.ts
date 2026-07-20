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

export const cefrColors: Record<string, string> = {
  A1: '#4CAF50',
  A2: '#8BC34A',
  B1: '#FFC107',
  B2: '#FF9800',
  C1: '#F44336',
  C2: '#9C27B0',
};

/**
 * Darkened CEFR variants — selected-chip / on-light-surface text where the
 * raw level colour lacks contrast (the Ledger filter bar + explainer band).
 */
export const cefrColorsDark: Record<string, string> = {
  A1: '#2F7D33',
  A2: '#5E8A1F',
  B1: '#8B6D00',
  B2: '#A85E00',
  C1: '#B93327',
  C2: '#7B1FA2',
};

export const cefrLabels: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Int.',
  C1: 'Advanced',
  C2: 'Mastery',
  IDIOMS: 'Idioms & Phrases',
};

/** Unabbreviated level names — the explainer band's eyebrow line. */
export const cefrLabelsFull: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Intermediate',
  C1: 'Advanced',
  C2: 'Mastery',
};

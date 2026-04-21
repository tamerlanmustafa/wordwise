// Canonical color palette. These values drive the running app — the older
// src/theme/index.ts belongs to unwired feature folders and will be removed
// once that dead code goes.

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

export const cefrLabels: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper Int.',
  C1: 'Advanced',
  C2: 'Mastery',
  IDIOMS: 'Idioms & Phrases',
};

// Deterministic CEFR + understandable % for homepage cards.
// Real values come from the backend once a script is analyzed.
// Until then we assign stable values so the UI is consistent across renders.

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

// Weighted distribution skewed toward B1-C1 (most feature films)
const WEIGHTS = [3, 8, 25, 32, 22, 10]; // sums to 100

export function getMovieCefr(movieId: number): CefrLevel {
  const bucket = movieId % 100;
  let cumulative = 0;
  for (let i = 0; i < WEIGHTS.length; i++) {
    cumulative += WEIGHTS[i];
    if (bucket < cumulative) return CEFR_LEVELS[i];
  }
  return 'B2';
}

// Returns a value 48–94, stable per movie
export function getUnderstandablePct(movieId: number): number {
  return 48 + (movieId * 13 + 7) % 46;
}

export const CEFR_COLOR: Record<CefrLevel, string> = {
  A1: '#43a047',
  A2: '#7cb342',
  B1: '#fdd835',
  B2: '#fb8c00',
  C1: '#e53935',
  C2: '#8e24aa',
};

export const CEFR_TEXT_COLOR: Record<CefrLevel, string> = {
  A1: '#fff',
  A2: '#fff',
  B1: '#333',
  B2: '#fff',
  C1: '#fff',
  C2: '#fff',
};

export const CEFR_LABEL: Record<CefrLevel, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
};

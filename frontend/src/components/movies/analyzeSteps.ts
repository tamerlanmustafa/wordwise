/**
 * Script-analysis checklist (Add-a-film §B) — web copy of
 * apps/mobile/src/components/movies/analyzeSteps.ts. Keep the two in sync;
 * the mobile copy carries the unit tests.
 */

export const ANALYZE_STEPS = [
  'Fetching the subtitles',
  'Matching the dictionary',
  'Ranking words by frequency',
  'Tagging CEFR levels',
] as const;

export type AnalyzePhase = 'fetching' | 'matching' | 'ranking' | 'tagging' | 'done';

const PHASE_ORDER: AnalyzePhase[] = ['fetching', 'matching', 'ranking', 'tagging', 'done'];

export function phaseToStep(phase: AnalyzePhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0) return 0;
  return Math.min(idx, ANALYZE_STEPS.length);
}

export function isAnalyzeComplete(phase: AnalyzePhase): boolean {
  return phase === 'done';
}

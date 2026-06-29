/**
 * Script-analysis checklist (Add-a-film §B). The four stages the user sees
 * while a film's script is turned into a word list, plus the pure mapping
 * from the client-observable analysis phase to the active checklist index.
 *
 * WordWise has no granular per-stage progress endpoint — the analysis is a
 * couple of sequential calls (fetch the script, then classify/rank/tag its
 * vocabulary). So the checklist is driven off the *real* phases the client
 * can observe rather than a fake timer: it advances as each phase resolves
 * and holds on the last active step until the final response lands.
 *
 * Web keeps an identical copy at frontend/src/components/movies/analyzeSteps.ts.
 */

export const ANALYZE_STEPS = [
  'Fetching the subtitles',
  'Matching the dictionary',
  'Ranking words by frequency',
  'Tagging CEFR levels',
] as const;

/** Client-observable phases of the add → analyze flow. */
export type AnalyzePhase = 'fetching' | 'matching' | 'ranking' | 'tagging' | 'done';

const PHASE_ORDER: AnalyzePhase[] = ['fetching', 'matching', 'ranking', 'tagging', 'done'];

/**
 * Active checklist index for a phase. Steps `< result` render done (green
 * check), `=== result` renders active (spinner), `> result` render pending.
 * `'done'` returns ANALYZE_STEPS.length so every step shows complete.
 */
export function phaseToStep(phase: AnalyzePhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  // Unknown phase → treat as the first step rather than crash.
  if (idx < 0) return 0;
  return Math.min(idx, ANALYZE_STEPS.length);
}

/** True once analysis is finished and the reel-ready state can show. */
export function isAnalyzeComplete(phase: AnalyzePhase): boolean {
  return phase === 'done';
}

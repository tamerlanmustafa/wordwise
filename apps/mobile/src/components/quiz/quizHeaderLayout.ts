/**
 * quizHeaderLayout — what the quiz top bar shows, as a pure decision.
 *
 * The header is shared by two kinds of surface: the card screens, which are
 * somewhere in a stack of N and want the counter and the gold progress bar,
 * and the session-complete screen, which is not in a stack at all. Rather than
 * give the done screen a second, differently-styled header (which is how it
 * drifted into the old paper bar with a "← Back" label), the header renders
 * the same chrome and drops the two pieces that only make sense mid-deck.
 *
 * No React here so the branch stays unit-testable under the logic-only jest
 * setup — same reasoning as `mcqLogic` and `navBarMetrics`.
 */

export interface QuizHeaderProgress {
  /** Render the N/total pill and the gold progress bar. */
  showProgress: boolean;
  /** Progress-bar fill, clamped to 0–100. Zero when there is no progress. */
  pct: number;
}

/**
 * A header with no position in a deck shows no counter and no bar. `total: 0`
 * counts as no progress too — a zero-card session would otherwise divide by
 * zero, and an empty bar claims a deck that isn't there.
 */
export function quizHeaderProgress(index?: number, total?: number): QuizHeaderProgress {
  if (typeof index !== 'number' || typeof total !== 'number' || total <= 0) {
    return { showProgress: false, pct: 0 };
  }
  return {
    showProgress: true,
    pct: Math.max(0, Math.min(100, (index / total) * 100)),
  };
}

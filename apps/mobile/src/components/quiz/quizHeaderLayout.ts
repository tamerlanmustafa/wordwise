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

// ── Position in a session that may have been resumed ───────────────────────
//
// `reviewSessionStore` caches an in-flight deck so quitting and reopening
// Practice picks the same cards back up. What it hands back is only the
// *remaining* cards — the answered ones are dropped as they are consumed —
// and the screen fed `cards.length` straight to the header. So a user who
// answered 3 of 10, closed the app and came back was told "1 / 7", with the
// gold bar reset to empty, for a session they were a third of the way
// through. The store has kept `totalCards` since it was written; nothing
// read it.
//
// The done screen never had the bug, because it counts from the running
// `got + forgot` totals, which the store *does* restore. That split — one
// surface counting the whole session, the other counting the tail — is why
// the position belongs in one shared function rather than at each call site.

export interface SessionPosition {
  /** 1-indexed card number across the whole session. */
  index: number;
  /** Cards in the whole session, resumed portion included. */
  total: number;
}

/**
 * Absolute position in a session, given the index within the cards currently
 * loaded and how many were already answered before this run.
 *
 * `answeredBefore` is 0 for a fresh session, which collapses to the obvious
 * `index + 1` of `remaining.length`.
 */
export function sessionPosition(
  indexInLoaded: number,
  loadedCount: number,
  answeredBefore: number,
): SessionPosition {
  const before = Math.max(0, answeredBefore);
  return {
    index: before + indexInLoaded + 1,
    total: before + loadedCount,
  };
}

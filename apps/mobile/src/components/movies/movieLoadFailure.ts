/**
 * movieLoadFailure — why a film has no vocabulary, as a pure decision.
 *
 * Opening a film can fail in three ways that want three different things from
 * the reader, and the screen used to show one paper box containing whatever
 * string the network layer threw — usually the words "Failed to fetch script",
 * under a Retry button:
 *
 *   • unavailable      — we reached every script source and none had this
 *     film. A permanent miss, and the one case where Retry is a lie: the
 *     button's only possible outcome is the same screen again. 196 of the
 *     4,585 films queued in prod are parked here, almost all "no script found
 *     in any source". The reader has done nothing wrong and there is nothing
 *     for them to do, so the copy says so and offers no button.
 *   • script_too_short — we found *something*, and it was a synopsis stub with
 *     nothing to teach from. Also permanent, also not the reader's problem,
 *     but a different sentence: we have the film, we cannot teach from it.
 *   • transient        — a timeout, a 500, an aeroplane. The only one where
 *     trying again is a real suggestion.
 *
 * The distinction between the first and the third is the server's to make, and
 * it already makes it: `routes/scripts.py` answers 404 only from
 * `ScriptNotFoundError` (every source exhausted) and 500 for everything else,
 * keyed on exception type rather than on error strings so a source's own "not
 * found" text cannot be misread. The client had been collapsing both into one
 * `Error` a line before it mattered.
 *
 * "Unavailable" is not forever. We add sources, and the ingest worker retries;
 * a film that misses today can land next month. That is why the copy says
 * "yet", and why search asks `/movies/availability` fresh on every keystroke
 * rather than remembering an answer that expires without telling anyone.
 *
 * No React here: the mobile suite is logic-only by policy, so a branch made
 * inside JSX is a branch nothing can test. Same reasoning, and the same shape,
 * as `quiz/emptyDeck`.
 */

// Type-only, so nothing native is pulled into a module the logic-only jest
// setup has to load.
import type { Ionicons } from '@expo/vector-icons';
import type { EmptyStateTone } from '../common/EmptyState';

/** Why the vocabulary is missing. `null` means it is not. */
export type MovieLoadFailure =
  | 'unavailable'
  | 'script_too_short'
  | 'transient'
  | null;

export interface MovieLoadFailureCopy {
  icon: keyof typeof Ionicons.glyphMap;
  tone: EmptyStateTone;
  titleKey: string;
  bodyKey: string;
  /**
   * Whether to offer Retry at all.
   *
   * The load-bearing field. A retry that cannot succeed is worse than no
   * button: it costs a round-trip, it returns the reader to the same screen,
   * and it implies the failure was theirs to fix.
   */
  retryable: boolean;
}

const COPY: Record<NonNullable<MovieLoadFailure>, MovieLoadFailureCopy> = {
  unavailable: {
    // Not an error glyph. Nothing broke — we simply do not have this film, and
    // a red warning triangle would tell the reader something went wrong when
    // the honest answer is that there is nothing here.
    icon: 'film-outline',
    tone: 'neutral',
    titleKey: 'movies:detail.unavailableTitle',
    bodyKey: 'movies:detail.unavailableBody',
    retryable: false,
  },
  script_too_short: {
    icon: 'document-text-outline',
    tone: 'neutral',
    titleKey: 'movies:detail.tooShortTitle',
    bodyKey: 'movies:detail.tooShortBody',
    retryable: false,
  },
  transient: {
    icon: 'cloud-offline-outline',
    tone: 'error',
    titleKey: 'movies:detail.loadFailedTitle',
    bodyKey: 'movies:detail.loadFailedBody',
    retryable: true,
  },
};

export function movieLoadFailureCopy(
  failure: NonNullable<MovieLoadFailure>,
): MovieLoadFailureCopy {
  return COPY[failure];
}

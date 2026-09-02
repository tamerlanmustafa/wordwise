/**
 * emptyDeck — which "no cards" screen to show, as a pure decision.
 *
 * `POST /srs/session/start` can answer with an empty deck for two reasons
 * that want opposite things from the user, and the screen rendered the same
 * green tick for both:
 *
 *   • caught_up   — nothing is due and there was nothing left to pad with.
 *     "You're all caught up" is true. Come back tomorrow.
 *   • unavailable — the server HAD words for this user and dropped every
 *     one of them, because it could not build a translation MCQ for any of
 *     them. That is usually a target language whose translation cache is
 *     still cold. Telling that user they are caught up is false, it sends
 *     them away for a day over something that often clears in minutes, and
 *     it makes a real outage invisible: the only trace was a server log
 *     line nobody was watching.
 *
 * The distinction is the server's to make — only it knows how many rows the
 * composer gathered before the card build threw them away — so it ships as
 * `deck_status`. Older server builds omit the field; an absent value means
 * "no opinion", and the honest reading of no opinion is the old behaviour.
 *
 * No React here: the mobile suite is logic-only by policy, so a branch made
 * inside JSX is a branch nothing can test.
 */

// Type-only, so nothing native is pulled into a module the logic-only jest
// setup has to load.
import type { Ionicons } from '@expo/vector-icons';
import type { EmptyStateTone } from '../common/EmptyState';

/** Mirrors `SessionStartResponse.deck_status` on the backend. */
export type DeckStatus = 'ok' | 'caught_up' | 'unavailable';

export interface EmptyDeckCopy {
  icon: keyof typeof Ionicons.glyphMap;
  tone: EmptyStateTone;
  titleKey: string;
  bodyKey: string;
  ctaKey: string;
  /** True when the CTA should re-run `/srs/session/start` rather than leave
   *  the screen. Only the recoverable case retries — offering "try again" on
   *  a genuinely empty queue would just re-draw the same empty queue. */
  retry: boolean;
}

const CAUGHT_UP: EmptyDeckCopy = {
  icon: 'checkmark-circle',
  tone: 'success',
  titleKey: 'quiz:review.caughtUpTitle',
  bodyKey: 'quiz:review.caughtUpBody',
  ctaKey: 'quiz:review.backHome',
  retry: false,
};

const UNAVAILABLE: EmptyDeckCopy = {
  icon: 'hourglass-outline',
  tone: 'error',
  titleKey: 'quiz:review.notReadyTitle',
  bodyKey: 'quiz:review.notReadyBody',
  ctaKey: 'action.retry',
  retry: true,
};

/**
 * Copy for an empty deck.
 *
 * `status` is whatever the server sent, including `undefined` from a build
 * that predates the field.
 */
export function emptyDeckCopy(status?: string | null): EmptyDeckCopy {
  return status === 'unavailable' ? UNAVAILABLE : CAUGHT_UP;
}

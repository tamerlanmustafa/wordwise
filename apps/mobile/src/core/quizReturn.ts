/**
 * Where the quiz flow lands when the user leaves it.
 *
 * The quiz is reached from two places — the movie preview hub (Saved Movies →
 * a film → "Quiz me") and the movie detail screen's "Quiz me" pill — and it can
 * be left from three (backing out of the Set Intro, exiting mid-lesson, and
 * dismissing the result). Each of those exits used to decide the destination
 * for itself, and they disagreed: Set Intro checked the origin, the result
 * screen checked the origin *and* the batch state, and the lesson's exit
 * checked neither. It sent the user to `quizJourney`, which is unreachable from
 * the current nav and renders nothing when the movie id hasn't resolved — so
 * quitting a lesson could leave a blank screen with only the tab bar on it.
 *
 * One function, three call sites: the exits can no longer drift apart.
 * `navParents` does the same job for the account area, but that map is static
 * and this answer depends on runtime state, so it lives here instead.
 */

import type { Screen } from './types';

/** Which entry point started the in-flight quiz. */
export type QuizOriginKind = 'reel-preview' | 'movie-detail';

export interface QuizReturnContext {
  /** The recorded entry point, or null when the quiz outlived it. */
  origin: QuizOriginKind | null;
  /** Whether the preview hub still has a tile to render. */
  hasPreviewTile: boolean;
  /** Whether a movie is still selected for the detail screen. */
  hasSelectedMovie: boolean;
}

/**
 * The screen to show when the quiz flow is left.
 *
 * Prefers the recorded origin, but only when that screen still has the state it
 * needs to render — `moviePreview` without a tile and `movieDetail` without a
 * movie both fall through App's render ternary and paint nothing. When the
 * origin is gone we take whichever context survived, and Home is the last
 * resort: never a dead end.
 */
export function quizReturnScreen({
  origin,
  hasPreviewTile,
  hasSelectedMovie,
}: QuizReturnContext): Screen {
  if (origin === 'movie-detail' && hasSelectedMovie) return 'movieDetail';
  if (origin === 'reel-preview' && hasPreviewTile) return 'moviePreview';
  if (hasPreviewTile) return 'moviePreview';
  if (hasSelectedMovie) return 'movieDetail';
  return 'films';
}

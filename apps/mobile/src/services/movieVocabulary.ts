/**
 * The network chain behind opening a movie.
 *
 * It used to be three stages, each waiting on the one before (issue #122):
 *
 *   fetchScript            -> external script API
 *   classifyVocabulary     -> POST /api/cefr/classify-script
 *   difficulty + vocabFull -> GET  /movies/{id}/...
 *
 * Stage 2 is the one that didn't need to be there. For a movie that has been
 * classified once — which is every movie anyone has already opened — it
 * re-reads the same classifications stage 3 is about to return, and the screen
 * throws its response away. It is still worth *firing*, because it backfills
 * difficulty/genre and tops up the sentence bank, but nothing on screen waits
 * for it. So when the script fetch reports `is_classified`, it goes out
 * unawaited and the open path drops from three round-trips to two.
 *
 * Lives here rather than in the screen so it is reachable from tests without a
 * component render (see mobile testing rules in CLAUDE.md).
 */
import { wordwiseApi, API_BASE_URL, type VocabularyResponse } from './api';

export type MovieDifficulty = { level: string; score: number };

export type MovieVocabularyResult =
  | {
      status: 'ok';
      vocab: VocabularyResponse;
      movieId: number;
      difficulty: MovieDifficulty | null;
    }
  | { status: 'script_too_short' };

/** Below this, a "script" is a synopsis stub with nothing to teach from. */
export const MIN_SCRIPT_WORDS = 100;

async function fetchDifficulty(movieId: number): Promise<MovieDifficulty | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/movies/${movieId}/difficulty`);
    if (!res.ok) return null;
    const d = await res.json();
    return d.difficulty_score != null
      ? { level: d.difficulty_level, score: d.difficulty_score }
      : null;
  } catch {
    return null;
  }
}

export async function fetchMovieVocabulary(params: {
  title: string;
  tmdbId?: number;
  targetLang: string;
  genreNames?: string[];
}): Promise<MovieVocabularyResult> {
  const { title, tmdbId, targetLang, genreNames } = params;

  const script = await wordwiseApi.fetchScript('', title, tmdbId);
  if (!script.cleaned_text || script.word_count < MIN_SCRIPT_WORDS) {
    return { status: 'script_too_short' };
  }

  const classify = () =>
    wordwiseApi.classifyVocabulary(script.movie_id, targetLang, genreNames);

  if (script.is_classified) {
    // Fire and forget: its side effects (difficulty/genre backfill, sentence
    // bank top-up) still happen, they just stop being something the user
    // watches a spinner for.
    classify().catch(() => {});
  } else {
    // First time anyone has opened this movie — /vocabulary/full has nothing
    // to return until this finishes, so it stays on the critical path.
    await classify();
  }

  // Neither of these depends on the other.
  const [difficulty, vocab] = await Promise.all([
    fetchDifficulty(script.movie_id),
    wordwiseApi
      .getVocabularyFull(script.movie_id)
      .catch(() => wordwiseApi.getVocabularyPreview(script.movie_id)),
  ]);

  return { status: 'ok', vocab, movieId: script.movie_id, difficulty };
}

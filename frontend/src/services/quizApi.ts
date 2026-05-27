/**
 * Quiz API — gamified study sessions.
 *
 * Mirrors apps/mobile/src/services/api.ts → quizApi. Endpoints:
 *   POST /quiz/sessions
 *   POST /quiz/sessions/{id}/cards
 *   POST /quiz/sessions/{id}/complete
 *   GET  /quiz/movies/{id}/units
 *   GET  /quiz/batch/units?movie_ids=
 *   POST /quiz/batch/sessions
 *   POST /quiz/pre-movie/{id}
 *   POST /quiz/journey/sessions
 *   GET  /quiz/leaderboard?metric=&limit=
 *   GET  /quiz/leaderboard/me?metric=
 */

import { apiClient } from './api';
import type { CefrLevel } from './reelApi';

export type QuizCardType = 'type' | 'self_rate' | 'synonym_mcq';
export type QuizSelfRating = 'know' | 'kinda' | 'dont';
export type QuizSessionKind = 'unit' | 'pre_movie' | 'batch';
export type QuizLeaderboardMetric = 'stars' | 'xp' | 'retention';

export interface QuizChoice {
  word: string;
  is_correct: boolean;
}

export interface QuizCard {
  word: string;
  card_type: QuizCardType;
  translation: string | null;
  pos?: string | null;
  syllables?: number | null;
  first_letter?: string | null;
  example_sentence?: string | null;
  translation_aliases?: string[] | null;
  choices?: QuizChoice[] | null;
  cefr_level?: CefrLevel | null;
}

export interface QuizStartSessionResponse {
  session_id: number;
  cards: QuizCard[];
}

export interface QuizCardResultInput {
  word: string;
  card_type: QuizCardType;
  is_correct: boolean | null;
  self_rating: QuizSelfRating | null;
  answer_ms: number;
}

export interface QuizCompleteResponse {
  stars: number;
  xp_earned: number;
  correct_count: number;
  total_scored: number;
  /** Frequency-weighted comprehension % of the session's movie, before
   *  vs after SRS advance. Null for batch / cross-movie sessions. */
  comprehension_before?: number | null;
  comprehension_after?: number | null;
}

export interface QuizUnitState {
  level: string;
  word_count: number;
  best_stars: number;
  attempts: number;
  locked: boolean;
}

export interface QuizLeaderboardEntry {
  user_id: number;
  username: string;
  profile_picture_url: string | null;
  total_stars: number;
  xp: number;
  retention_score: number;
  rank: number;
}

export interface QuizMyRankResponse {
  rank: number | null;
  me: {
    user_id: number;
    username: string;
    total_stars: number;
    xp: number;
    retention_score: number;
  } | null;
  neighbors: Array<{
    rank: number;
    user_id: number;
    username: string;
    value: number;
  }>;
}

export const quizApi = {
  startSession: async (
    movieId: number,
    level: string,
    kind: QuizSessionKind = 'unit',
  ): Promise<QuizStartSessionResponse> => {
    const res = await apiClient.post<QuizStartSessionResponse>(`/quiz/sessions`, {
      movie_id: movieId,
      level,
      kind,
    });
    return res.data;
  },

  submitCards: async (
    sessionId: number,
    results: QuizCardResultInput[],
  ): Promise<{ stored: number }> => {
    const res = await apiClient.post<{ stored: number }>(
      `/quiz/sessions/${sessionId}/cards`,
      { results },
    );
    return res.data;
  },

  completeSession: async (sessionId: number): Promise<QuizCompleteResponse> => {
    const res = await apiClient.post<QuizCompleteResponse>(
      `/quiz/sessions/${sessionId}/complete`,
    );
    return res.data;
  },

  getMovieUnits: async (movieId: number): Promise<QuizUnitState[]> => {
    const res = await apiClient.get<QuizUnitState[]>(
      `/quiz/movies/${movieId}/units`,
    );
    return res.data;
  },

  getBatchUnits: async (movieIds: number[]): Promise<QuizUnitState[]> => {
    const qs = encodeURIComponent(movieIds.join(','));
    const res = await apiClient.get<QuizUnitState[]>(
      `/quiz/batch/units?movie_ids=${qs}`,
    );
    return res.data;
  },

  startBatchSession: async (
    movieIds: number[],
    level: string,
    kind: QuizSessionKind = 'batch',
  ): Promise<QuizStartSessionResponse> => {
    const res = await apiClient.post<QuizStartSessionResponse>(
      `/quiz/batch/sessions`,
      { movie_ids: movieIds, level, kind },
    );
    return res.data;
  },

  startJourneySession: async (
    level: string,
    tileIndex: number,
    wordsPerTile = 5,
    tmdbId?: number,
  ): Promise<QuizStartSessionResponse> => {
    const res = await apiClient.post<QuizStartSessionResponse>(
      `/quiz/journey/sessions`,
      {
        level,
        tile_index: tileIndex,
        words_per_tile: wordsPerTile,
        ...(tmdbId != null ? { tmdb_id: tmdbId } : {}),
      },
    );
    return res.data;
  },

  startPreMovieQuiz: async (movieId: number): Promise<QuizStartSessionResponse> => {
    const res = await apiClient.post<QuizStartSessionResponse>(
      `/quiz/pre-movie/${movieId}`,
    );
    return res.data;
  },

  getLeaderboard: async (
    metric: QuizLeaderboardMetric = 'stars',
    limit = 50,
  ): Promise<QuizLeaderboardEntry[]> => {
    const res = await apiClient.get<QuizLeaderboardEntry[]>(
      `/quiz/leaderboard?metric=${metric}&limit=${limit}`,
    );
    return res.data;
  },

  getMyRank: async (
    metric: QuizLeaderboardMetric = 'stars',
  ): Promise<QuizMyRankResponse> => {
    const res = await apiClient.get<QuizMyRankResponse>(
      `/quiz/leaderboard/me?metric=${metric}`,
    );
    return res.data;
  },
};

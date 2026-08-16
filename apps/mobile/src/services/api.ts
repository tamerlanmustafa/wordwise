import AsyncStorage from '@react-native-async-storage/async-storage';
import { config, TMDB_API_KEY } from '../config/env';
import { tokenStorage } from './auth/tokenStorage';
import type {
  ListDetail,
  ListItem,
  ListKind,
  ListSort,
  ListSummary,
  ListSystemKey,
  ListWordItem,
} from '../core/types';

// Use centralized config for API URL
const API_BASE_URL = config.API_URL;

// Types
interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  overview: string;
  vote_average: number;
  genre_ids: number[];
}

export interface MovieSearchResult {
  id: string;
  title: string;
  year: string;
  subtitle: string;
  author: string;
  genre: string;
  link: string;
}

interface TMDBMetadata {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string;
  genres: string[];
  popularity: number;
}

export interface MovieSearchResponse {
  query: string;
  results: MovieSearchResult[];
  total: number;
  tmdb_metadata: TMDBMetadata | null;
}

export interface WordInfo {
  word: string;
  lemma: string;
  confidence: number;
  frequency_rank: number | null;
}

export interface IdiomInfo {
  phrase: string;
  type: 'phrasal_verb' | 'idiom';
  cefr_level: string;
  words: string[];
}

export interface VocabularyResponse {
  movie_id: number;
  script_id: number;
  total_words: number;
  unique_words: number;
  level_distribution: {
    A1: number;
    A2: number;
    B1: number;
    B2: number;
    C1: number;
    C2: number;
  };
  average_confidence: number;
  wordlist_coverage: number;
  top_words_by_level: {
    [level: string]: WordInfo[];
  };
  idioms?: IdiomInfo[];
}

interface ScriptResponse {
  script_id: number;
  movie_id: number;
  source_used: string;
  cleaned_text: string;
  word_count: number;
  is_complete: boolean;
  is_truncated: boolean;
  from_cache: boolean;
  metadata: {
    title: string;
    year?: string;
    author?: string;
    genre?: string;
  };
  fetched_at: string | null;
}

interface TranslationResponse {
  source: string;
  translated: string;
  target_lang: string;
  source_lang: string | null;
  cached: boolean;
  provider?: string | null;
}

// Helper to get auth token
const getAuthToken = async (): Promise<string | null> => {
  try {
    return await tokenStorage.getAccessToken();
  } catch {
    return null;
  }
};

// ─── Token refresh ──────────────────────────────────────────────────────
// The access token is short-lived (24h). Rather than logging the user out
// the moment it expires, authFetch transparently exchanges the long-lived
// refresh token for a new pair on a 401, then retries the request once.
//
// Registered by the app on boot; called when refresh itself fails (refresh
// token missing/expired/revoked) so the session can be torn down and the
// login screen shown — instead of silently 401-ing every request forever.
let onSessionExpired: (() => void) | null = null;
export const setOnSessionExpired = (fn: () => void): void => {
  onSessionExpired = fn;
};

// Single-flight: a burst of parallel requests that all 401 share one
// refresh round-trip instead of stampeding /auth/refresh.
let refreshPromise: Promise<string | null> | null = null;

const doRefresh = async (): Promise<string | null> => {
  const refresh = await tokenStorage.getRefreshToken();
  if (!refresh) return null;
  try {
    // Plain fetch (not authFetch) — must not recurse through the 401 path.
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.token || !data?.refresh_token) return null;
    await tokenStorage.saveTokens(data.token, data.refresh_token);
    return data.token as string;
  } catch {
    return null;
  }
};

const refreshAccessToken = (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

// Helper for authenticated requests. On a 401 it refreshes once and retries;
// if the refresh fails, it tears down the session via onSessionExpired.
// Exported so components doing one-off enrichment/translation fetches can
// reuse the same auth + refresh handling instead of bare fetch().
export const authFetch = async (
  url: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> => {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && retry && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      // Retry once with the refreshed token; don't retry again on a 2nd 401.
      return authFetch(url, options, false);
    }
    // Refresh token is gone/expired — the session is genuinely dead.
    onSessionExpired?.();
  }
  return res;
};

// TMDB API
export const tmdbApi = {
  getTrending: async (): Promise<TMDBMovie[]> => {
    const res = await fetch(
      `https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_API_KEY}`
    );
    const data = await res.json();
    return data.results || [];
  },

  getTopRated: async (): Promise<TMDBMovie[]> => {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_API_KEY}`
    );
    const data = await res.json();
    return data.results || [];
  },

  searchMovies: async (query: string): Promise<TMDBMovie[]> => {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    return data.results || [];
  },

  getMovieDetails: async (tmdbId: number): Promise<TMDBMovie> => {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`
    );
    return res.json();
  },

  getPosterUrl: (posterPath: string | null, size: 'w185' | 'w300' | 'w500' = 'w300'): string | null => {
    if (!posterPath) return null;
    return `https://image.tmdb.org/t/p/${size}${posterPath}`;
  },

  /** Returns all available images for a movie: backdrops, posters, logos. */
  getMovieImages: async (tmdbId: number): Promise<{
    backdrops: Array<{ file_path: string; width: number; height: number; vote_average: number; vote_count: number }>;
    posters:   Array<{ file_path: string; width: number; height: number; vote_average: number; vote_count: number }>;
    logos:     Array<{ file_path: string; width: number; height: number; vote_average: number; vote_count: number }>;
  }> => {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${TMDB_API_KEY}`
    );
    const data = await res.json();
    return {
      backdrops: data.backdrops || [],
      posters:   data.posters   || [],
      logos:     data.logos     || [],
    };
  },
};

/**
 * Enriches WordWise/CEFR movie rows (which only carry tmdb_id + poster_url)
 * with the poster_path / backdrop_path / overview / release_date the cards
 * render. Requests run in parallel and any failure falls back to the original
 * row, so one bad TMDB lookup never blocks a page. Call this per page as the
 * infinite list loads — never on the whole catalog at once.
 */
export async function enrichMoviesWithTmdb<
  T extends { tmdb_id?: number | null; description?: string | null; year?: number | null }
>(movies: T[]): Promise<T[]> {
  return Promise.all(
    movies.map(async (m) => {
      if (!m.tmdb_id) return m;
      try {
        const t: any = await tmdbApi.getMovieDetails(m.tmdb_id);
        return {
          ...m,
          overview: t.overview || m.description || '',
          poster_path: t.poster_path || null,
          backdrop_path: t.backdrop_path || null,
          release_date: t.release_date || (m.year ? `${m.year}-01-01` : ''),
        };
      } catch {
        return m;
      }
    })
  );
}

// WordWise API
export const wordwiseApi = {
  // Search for movies with scripts (requires an authenticated user — the
  // backend gates this because it fans out to paid script/subtitle APIs)
  searchMovies: async (query: string): Promise<MovieSearchResponse> => {
    const res = await authFetch(`${API_BASE_URL}/api/scripts/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Failed to search movies');
    return res.json();
  },

  // Fetch script for a movie (requires an authenticated user)
  fetchScript: async (
    scriptId: string,
    movieTitle?: string,
    tmdbId?: number,
  ): Promise<ScriptResponse> => {
    const res = await authFetch(`${API_BASE_URL}/api/scripts/fetch`, {
      method: 'POST',
      body: JSON.stringify({
        script_id: scriptId,
        movie_title: movieTitle,
        tmdb_id: tmdbId,
        force_refresh: false,
      }),
    });
    if (!res.ok) throw new Error('Failed to fetch script');
    return res.json();
  },

  // Classify movie vocabulary with CEFR levels (requires an authenticated user)
  classifyVocabulary: async (movieId: number, targetLanguage: string = 'ES', genres?: string[]): Promise<VocabularyResponse> => {
    const res = await authFetch(`${API_BASE_URL}/api/cefr/classify-script`, {
      method: 'POST',
      body: JSON.stringify({
        movie_id: movieId,
        save_to_db: true,
        target_language: targetLanguage,
        ...(genres && genres.length > 0 ? { genres } : {}),
      }),
    });
    if (!res.ok) throw new Error('Failed to classify vocabulary');
    return res.json();
  },

  // Get vocabulary preview (no auth required)
  getVocabularyPreview: async (movieId: number): Promise<VocabularyResponse> => {
    const res = await fetch(`${API_BASE_URL}/movies/${movieId}/vocabulary/preview`);
    if (!res.ok) throw new Error('Failed to get vocabulary preview');
    return res.json();
  },

  // Get full vocabulary (auth required)
  getVocabularyFull: async (movieId: number): Promise<VocabularyResponse> => {
    const res = await authFetch(`${API_BASE_URL}/movies/${movieId}/vocabulary/full`);
    if (!res.ok) throw new Error(`Failed to get vocabulary: ${res.status}`);
    return res.json();
  },

  // List processed movies filtered by CEFR difficulty (no auth required).
  // Backend joins movie_jobs to surface tmdb_id so the client can lazily
  // fetch poster/overview from TMDB.
  getMoviesByLevel: async (level: string, limit: number = 50): Promise<{
    level: string;
    total: number;
    movies: Array<{
      movie_id: number;
      tmdb_id: number | null;
      title: string;
      year: number | null;
      poster_url: string | null;
      description: string | null;
      difficulty_score: number | null;
    }>;
  }> => {
    const res = await fetch(
      `${API_BASE_URL}/movies/by-level?level=${encodeURIComponent(level)}&limit=${limit}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /movies/by-level → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  getMoviesByCefr: async (
    level: string,
    limit: number = 50,
    opts?: {
      offset?: number;
      sort?: 'rating' | 'popularity' | 'level';
      order?: 'asc' | 'desc';
    }
  ): Promise<{
    level: string;
    total: number;
    offset: number;
    has_more: boolean;
    movies: Array<{
      movie_id: number;
      tmdb_id: number | null;
      title: string;
      year: number | null;
      poster_url: string | null;
      description: string | null;
      difficulty_score: number | null;
      vote_average: number | null;
      vote_count: number | null;
    }>;
  }> => {
    let query = `level=${encodeURIComponent(level)}&limit=${limit}`;
    if (opts?.offset != null) query += `&offset=${opts.offset}`;
    if (opts?.sort) query += `&sort=${opts.sort}`;
    if (opts?.order) query += `&order=${opts.order}`;
    // authFetch (not plain fetch): /movies/by-cefr personalizes when a token
    // is present — it excludes the user's watched / not-interested movies, so
    // swiped-away cards don't reappear when a filter/sort refetches the feed.
    const res = await authFetch(`${API_BASE_URL}/movies/by-cefr?${query}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /movies/by-cefr → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  // Get movie difficulty
  getMovieDifficulty: async (movieId: number): Promise<{
    difficulty_level: string;
    difficulty_score: number;
    breakdown: Record<string, number>;
  }> => {
    const res = await fetch(`${API_BASE_URL}/movies/${movieId}/difficulty`);
    if (!res.ok) throw new Error('Failed to get difficulty');
    return res.json();
  },

  // Translate text.
  // `sentence` is an optional context hint: when a single word is looked up
  // from an example sentence, passing that sentence lets the backend bias the
  // word's translation to the sense it carries in context (DeepL `context`),
  // so the word gloss matches the sentence translation shown next to it.
  translate: async (
    text: string,
    targetLang: string,
    userId?: number,
    movieId?: number | null,
    sentence?: string | null
  ): Promise<TranslationResponse> => {
    const body: Record<string, unknown> = {
      text,
      target_lang: targetLang,
      source_lang: 'auto',
      user_id: userId,
    };
    if (movieId) body.movie_id = movieId;
    if (sentence) body.sentence = sentence;

    // authFetch attaches the bearer token (endpoint now requires login).
    const res = await authFetch(`${API_BASE_URL}/translate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to translate');
    return res.json();
  },

  // Save/unsave a word (toggle)
  saveWord: async (word: string, movieId?: number | null): Promise<{ saved: boolean; word: string }> => {
    const res = await authFetch(`${API_BASE_URL}/user/words/save`, {
      method: 'POST',
      body: JSON.stringify({ word, movie_id: movieId || undefined }),
    });
    if (!res.ok) throw new Error('Failed to save word');
    return res.json();
  },

  // Get all saved words for the user
  getSavedWords: async (): Promise<SavedWordEntry[]> => {
    const res = await authFetch(`${API_BASE_URL}/user/words/`);
    if (!res.ok) throw new Error('Failed to get saved words');
    return res.json();
  },

  // Mark a word as learned globally — hides it from every movie's list.
  markWordLearned: async (word: string): Promise<{ learned: boolean; word: string }> => {
    const res = await authFetch(`${API_BASE_URL}/user/words/mark-learned`, {
      method: 'POST',
      body: JSON.stringify({ word }),
    });
    if (!res.ok) throw new Error('Failed to mark word learned');
    return res.json();
  },

  // Reverse mark-learned. Word reappears in movie vocabulary lists.
  unlearnWord: async (word: string): Promise<{ learned: boolean; word: string }> => {
    const res = await authFetch(`${API_BASE_URL}/user/words/unlearn`, {
      method: 'POST',
      body: JSON.stringify({ word }),
    });
    if (!res.ok) throw new Error('Failed to unlearn word');
    return res.json();
  },

  getLearnedWords: async (): Promise<Array<{ id: number; word: string; created_at: string }>> => {
    const res = await authFetch(`${API_BASE_URL}/user/words/learned`);
    if (!res.ok) throw new Error('Failed to get learned words');
    return res.json();
  },

  // Log a user interaction (fire-and-forget)
  logInteraction: async (word: string, interactionType: string, movieId?: number | null, metadata?: Record<string, unknown>): Promise<void> => {
    try {
      await authFetch(`${API_BASE_URL}/user/interactions`, {
        method: 'POST',
        body: JSON.stringify({
          word,
          movie_id: movieId || undefined,
          interaction_type: interactionType,
          metadata: metadata || undefined,
        }),
      });
    } catch {
      // Fire-and-forget: don't let tracking failures affect UX
    }
  },

  // Batch lookup of in-movie example sentences. One round trip for many
  // words; backend hits SentenceBank only (fast path) and skips misses.
  batchSentences: async (
    movieId: number,
    words: string[],
    maxExamples: number = 1,
  ): Promise<Record<string, { sentence: string; word_position: number; matched_form: string }[]>> => {
    if (!words.length) return {};
    const t0 = Date.now();
    const res = await authFetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/batch`, {
      method: 'POST',
      body: JSON.stringify({ words, max_examples: maxExamples }),
    });
    const httpMs = Date.now() - t0;
    if (!res.ok) {
      console.warn('[batchSentences] HTTP error', { status: res.status, httpMs, words: words.length });
      return {};
    }
    const data = await res.json();
    return data.results || {};
  },
};

// =====================================================================
// Reports + Admin
// =====================================================================

export type ReportReason =
  | 'WRONG_TRANSLATION'
  | 'WRONG_CONTEXT'
  | 'WRONG_SPELLING'
  | 'INAPPROPRIATE_CONTENT'
  | 'OTHER';

export type ReportStatus = 'PENDING' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';

export interface WordReport {
  id: number;
  word: string;
  movie_id?: number;
  movie_title?: string;
  reason: ReportReason;
  details?: string;
  translation_source?: string;
  status: ReportStatus;
  reporter_id: number;
  reporter_email?: string;
  reviewer_id?: number;
  reviewer_email?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ReportStats {
  pending: number;
  reviewed: number;
  resolved: number;
  dismissed: number;
  total: number;
}

export interface ProcessedMovie {
  movie_id: number;
  tmdb_id: number | null;
  title: string;
  year: number | null;
  difficulty_level: string | null;
  difficulty_score: number | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
}

export interface DeadJob {
  id: number;
  tmdb_id: number;
  title: string;
  year: number | null;
  attempts: number;
  last_error: string | null;
  finished_at: number | null;
}

export interface AdminStats {
  movies_total: number;
  movies_processed: number;
  users_total: number;
  movies_by_level: Record<string, number>;
  queue: {
    done: number | null;
    pending: number | null;
    running: number | null;
    dead: number | null;
  };
}

export type VocabCoverageStatus = 'ok' | 'warn' | 'fail';

export interface VocabCoverageMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  status: VocabCoverageStatus;
  /** Human-readable band, e.g. "warn <90%, fail <80%". */
  threshold: string;
  /** Same bands, structured, so the UI can draw meter markers without
   *  re-declaring (and drifting from) the server's numbers. */
  warn_at: number | null;
  fail_at: number | null;
  /** "min" = higher is better, "max" = higher is worse. */
  direction: 'min' | 'max';
  /** Present = bounded scale, render as a meter. Null = unbounded count, render
   *  as a stat tile. */
  max_value: number | null;
  detail?: string;
  previous?: number;
  delta?: number;
}

export interface VocabCoverageReport {
  generated_at: string;
  overall_status: VocabCoverageStatus;
  previous_snapshot_at: string | null;
  llm_cost_cap_usd: number;
  metrics: VocabCoverageMetric[];
}

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  WRONG_TRANSLATION: 'Wrong translation',
  WRONG_CONTEXT: "Doesn't match context",
  WRONG_SPELLING: 'Wrong spelling',
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  OTHER: 'Other issue',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  PENDING: 'Pending',
  REVIEWED: 'Reviewed',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};

export const reportsApi = {
  // User-facing: submit a new report.
  create: async (data: {
    word: string;
    movie_id?: number;
    movie_title?: string;
    reason: ReportReason;
    details?: string;
    translation_source?: string;
  }): Promise<{ success: boolean; report_id: number }> => {
    const res = await authFetch(`${API_BASE_URL}/api/reports/`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to submit report: ${res.status} ${text}`);
    }
    return res.json();
  },

  // Admin: list reports, optionally filtered.
  // NOTE: avoid `new URL(...)` — React Native's URL polyfill is incomplete
  // and silently produces malformed URLs on iOS. Stick to string concat.
  listAdmin: async (statusFilter?: ReportStatus): Promise<WordReport[]> => {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    const res = await authFetch(`${API_BASE_URL}/api/reports/admin${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /api/reports/admin → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  // Admin: update status / notes.
  update: async (
    id: number,
    update: { status: ReportStatus; review_notes?: string }
  ): Promise<{ success: boolean; report_id: number; status: ReportStatus }> => {
    const res = await authFetch(`${API_BASE_URL}/api/reports/admin/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error('Failed to update report');
    return res.json();
  },

  // Admin: aggregate counts for the dashboard.
  stats: async (): Promise<ReportStats> => {
    const res = await authFetch(`${API_BASE_URL}/api/reports/admin/stats`);
    if (!res.ok) throw new Error('Failed to fetch report stats');
    return res.json();
  },

  // Admin: hard-delete (rare; usually we just status=DISMISSED).
  remove: async (id: number): Promise<{ success: boolean; deleted_id: number }> => {
    const res = await authFetch(`${API_BASE_URL}/api/reports/admin/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete report');
    return res.json();
  },
};

// SRS review types — mirrors backend/src/routes/srs.py.
interface MCQChoicePayload {
  word: string;
  is_correct: boolean;
}

export interface SrsReviewCard {
  user_word_id: number;
  word: string;
  movie_id: number | null;
  movie_title: string | null;
  srs_box: number;
  srs_due_at: string;
  definition: string | null;
  example_sentence: string | null;
  cefr_level: string | null;
  /** 'mcq' — a 4-choice translation pick (replaced the retired
   *  typed-translation and synonym cards). Client scores the tap
   *  locally and posts the boolean to /srs/review. Cards with unknown
   *  types get skipped on the client. */
  card_type?: 'mcq';
  /** Present for 'mcq': 4 entries, exactly one is_correct. */
  choices?: MCQChoicePayload[];
  pos?: string | null;
  /** Canonical translation — the correct 'mcq' choice, echoed for
   *  callout copy. */
  translation?: string | null;
}

/** v0.7.2 — Practice-tab "session kind". The user picks one tile per
 *  UTC day on the Practice screen; that pick is passed to
 *  `srsApi.startSession({ kind })`. Server-side dispatch in
 *  `services/session_kinds.py`. */
export type SessionKind =
  | 'quick_recall'
  | 'tough_words'
  | 'movie_deep_dive'
  // Lists tab. Started from a list's gold action rather than a Practice
  // tile, so these never appear on the Practice path — but a session in
  // flight is cached by kind, so the union has to carry them.
  | 'list_words'
  | 'list_films';

/** @deprecated v0.7.3 — streak-based unlocks were retired in favor of
 *  the Duolingo-style linear path (see `stores/practicePathStore.ts`).
 *  Kept here so any stale references compile while we sweep callers;
 *  remove when the next backend version drops the column entirely. */
export const KIND_UNLOCK_THRESHOLDS: Record<SessionKind, number> = {
  quick_recall:    0,
  tough_words:     0,
  movie_deep_dive: 0,
  list_words:      0,
  list_films:      0,
};

export interface SrsSessionStart {
  cards: SrsReviewCard[];
  total_due: number;
  session_size: number;
  is_preview: boolean;
  previews_remaining: number;
  /** v0.7.2 — echoed back so the client confirms which tile was claimed. */
  kind?: SessionKind;
}

export interface SavedWordEntry {
  id: number;
  word: string;
  movie_id: number | null;
  is_learned: boolean;
  created_at: string;
  saved_in_count: number;
  saved_in_movies: Array<{ title: string; created_at: string; movie_id: number }>;
}

export interface TodaysWord {
  word: string;
  translated_word: string | null;
  example_sentence: string | null;
  translated_sentence: string | null;
  cefr_level: string | null;
  // Legacy movie attribution. Today's word is no longer drawn from a specific
  // movie — these are always null from the server now and only kept so older
  // payloads still type-check.
  movie_title?: string | null;
  movie_poster_url?: string | null;
  movie_id?: number | null;
}

/** Char offsets of the inflected form inside `sentence`, computed server-side
 *  so the Explore card can gold-wash "lingered", not "linger". */
export interface SentenceMatch {
  start: number;
  end: number;
}

/** One card in the Explore feed (GET /srs/feed). */
export interface FeedItem {
  lemma_id: number;
  word: string;
  /** No pronunciation source exists yet — always null today. The card hides
   *  the IPA line when it is, so a future source needs no client change. */
  ipa: string | null;
  pos: string | null;
  cefr: string | null;
  sentence: string;
  sentence_match: SentenceMatch | null;
  translated_word: string | null;
  translated_sentence: string | null;
  translation_source: string | null;
}

/** The share of each page drawn from each CEFR level. Must total 100. */
export type LevelMix = Record<string, number>;

export interface FeedResponse {
  items: FeedItem[];
  /** What the server could honour — diverges from the request when a
   *  level runs dry. */
  mix_applied: LevelMix;
  has_more: boolean;
}

export interface SrsStats {
  total_saved: number;
  due_now: number;
  due_today: number;
  by_box: Record<string, number>;
  is_premium: boolean;
  previews_remaining: number;
  current_streak: number;
  longest_streak: number;
  total_reviews: number;
  total_correct: number;
  retention_pct: number;
}

/** v0.6 chest reward returned by POST /srs/session/complete. */
export type ChestKind = 'xp_small' | 'xp_large' | 'freeze' | 'cosmetic';

export interface ChestPayload {
  kind: ChestKind;
  label: string;
  payload: {
    xp?: number;
    freezes?: number;
    cosmetic_name?: string;
  };
}

interface CompleteSessionResponse {
  chest: ChestPayload | null;
  already_claimed: boolean;
  correct_count: number;
  total_count: number;
  streak: number;
  /** v0.6 W10 — full inventory of unlocked milestone slugs
   *  ("opening_weekend" / "box_office" / "cult_classic" /
   *  "criterion_collection"). Diff against AsyncStorage last-seen
   *  to detect new unlocks for the celebration modal. */
  unlocked_cosmetics: string[];
}

export interface DailyState {
  today_done: boolean;
  streak: number;
  longest_streak: number;
  freezes_held: number;
  last_session_date: string | null;
  repair_window_active: boolean;
  auto_granted_weekly: boolean;
  auto_consumed: number;
  /** v0.6 W10 — same shape as in CompleteSessionResponse. */
  unlocked_cosmetics: string[];
  /** v0.7.2 — Practice tile picked today, or null when today's session
   *  hasn't started yet. Drives the tile-state matrix on PracticeScreen. */
  last_session_kind?: SessionKind | null;
}

interface CreditedFreezesResponse {
  credited: number;
  freezes_held: number;
  capped: boolean;
}

// Thrown when /srs/session/start returns 402 (preview budget exhausted).
// The session screen catches this and pushes the paywall screen instead.
/** Kind of paywall fired by the SRS endpoints.
 *  - `preview_exhausted`: legacy (pre-v0.6) — free preview sessions used up
 *  - `daily_cap_reached`: v0.6 — free user already did today's session
 *  Default 'preview_exhausted' for backwards compat with older clients. */
type SrsPaywallKind = 'preview_exhausted' | 'daily_cap_reached';

export class SrsPaywallError extends Error {
  kind: SrsPaywallKind;
  previews_used: number;
  previews_limit: number;
  constructor(
    message: string,
    previews_used: number,
    previews_limit: number,
    kind: SrsPaywallKind = 'preview_exhausted',
  ) {
    super(message);
    this.name = 'SrsPaywallError';
    this.kind = kind;
    this.previews_used = previews_used;
    this.previews_limit = previews_limit;
  }
}

export const srsApi = {
  stats: async (): Promise<SrsStats> => {
    const res = await authFetch(`${API_BASE_URL}/srs/stats`);
    if (!res.ok) throw new Error(`GET /srs/stats → ${res.status}`);
    return res.json();
  },

  startSession: async (opts: {
    /** v0.7.2 — Practice-tab tile. Defaults to `quick_recall` when
     *  unspecified; backward-compatible with older callers. */
    kind?: SessionKind;
    /** Required when `kind === 'movie_deep_dive'`. The internal Movie.id. */
    movieId?: number;
  } = {}): Promise<SrsSessionStart> => {
    // RN's URLSearchParams polyfill lacks .set, so we build the query
    // string by hand. Both params are optional; older callers that pass
    // no opts at all hit the backend default (quick_recall).
    const qsParts: string[] = [];
    if (opts.kind) qsParts.push(`kind=${encodeURIComponent(opts.kind)}`);
    if (typeof opts.movieId === 'number') {
      qsParts.push(`movie_id=${opts.movieId}`);
    }
    const url = qsParts.length
      ? `${API_BASE_URL}/srs/session/start?${qsParts.join('&')}`
      : `${API_BASE_URL}/srs/session/start`;
    const res = await authFetch(url, { method: 'POST' });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail || {};
      const kind: SrsPaywallKind =
        detail.paywall === 'srs_daily_cap_reached' ? 'daily_cap_reached' : 'preview_exhausted';
      throw new SrsPaywallError(
        detail.message || 'Review session unavailable',
        detail.previews_used ?? 0,
        detail.previews_limit ?? 0,
        kind,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST /srs/session/start → ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  review: async (userWordId: number, correct: boolean): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/srs/review`, {
      method: 'POST',
      body: JSON.stringify({ user_word_id: userWordId, correct }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST /srs/review → ${res.status} ${text.slice(0, 120)}`);
    }
  },

  /** v0.6: call once after the LAST /srs/review of a daily session.
   *  Returns the variable-reward chest (null on subsequent same-day
   *  calls — `already_claimed=true`). Server picks the reward to keep
   *  the random roll tamper-proof. */
  completeSession: async (
    correctCount: number,
    totalCount: number,
  ): Promise<CompleteSessionResponse> => {
    const res = await authFetch(`${API_BASE_URL}/srs/session/complete`, {
      method: 'POST',
      body: JSON.stringify({ correct_count: correctCount, total_count: totalCount }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST /srs/session/complete → ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  todaysWord: async (skip = 0, targetLang?: string): Promise<TodaysWord | null> => {
    // Same word for the whole clock hour per language; cache locally so
    // navigation between tabs/screens doesn't re-fetch (and re-translate).
    const hour = new Date().toISOString().slice(0, 13);
    const cacheKey = `word_of_hour_v1:${hour}:${targetLang ?? 'native'}:skip${skip}`;
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as TodaysWord;
    } catch {}

    const qs = `skip=${skip}${targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : ''}`;
    const res = await authFetch(`${API_BASE_URL}/srs/today?${qs}`);
    if (!res.ok) return null;
    const body = await res.json();
    if (body) {
      AsyncStorage.setItem(cacheKey, JSON.stringify(body)).catch(() => {});
    }
    return body || null;
  },

  /** Explore feed page.
   *
   *  No response cache here on purpose — `wordFeedStore` keeps its own
   *  buffer of recent cards on disk, which is what makes the tab paint
   *  instantly, and a second cache layer keyed by URL would fight both the
   *  per-launch `seed` and the reset-on-mix-change flow.
   *
   *  `seed` fixes the server's shuffle. Pass the same one for every page of
   *  a session: `offset` indexes into a sequence that only holds still while
   *  the seed does. */
  feed: async (params: {
    limit?: number;
    offset?: number;
    targetLang?: string;
    mix?: LevelMix;
    seed?: string;
  } = {}): Promise<FeedResponse> => {
    const { limit = 20, offset = 0, targetLang, mix, seed } = params;
    const qs = [`limit=${limit}`, `offset=${offset}`];
    if (targetLang) qs.push(`target_lang=${encodeURIComponent(targetLang)}`);
    if (mix) {
      const encoded = Object.entries(mix)
        .map(([level, pct]) => `${level}:${pct}`)
        .join(',');
      qs.push(`mix=${encodeURIComponent(encoded)}`);
    }
    if (seed) qs.push(`seed=${encodeURIComponent(seed)}`);
    const res = await authFetch(`${API_BASE_URL}/srs/feed?${qs.join('&')}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET /srs/feed → ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },
};

/** v0.6 daily-habit hydration + freeze IAP / debug-grant. */
export const dailyApi = {
  state: async (): Promise<DailyState> => {
    const res = await authFetch(`${API_BASE_URL}/daily/state`);
    if (!res.ok) throw new Error(`GET /daily/state → ${res.status}`);
    return res.json();
  },

  /** Dev-only shortcut to credit a freeze pack without the IAP. Returns
   *  401/403 in production for non-admin callers. Useful for exercising
   *  the full mercy UX before Apple/Google credentials land. */
  debugGrantFreezes: async (): Promise<CreditedFreezesResponse> => {
    const res = await authFetch(
      `${API_BASE_URL}/consumables/freeze-pack/debug-grant`,
      { method: 'POST' },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST /consumables/freeze-pack/debug-grant → ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },
};

// Premium feature APIs (Phase 4). All return 402 for non-premium users.
export interface CrossMovieSentence {
  movie_id: number;
  movie_title: string;
  sentence: string;
  cefr_level: string | null;
}

export const premiumApi = {
  crossMovieSentences: async (word: string): Promise<CrossMovieSentence[]> => {
    const res = await authFetch(
      `${API_BASE_URL}/premium/sentences/${encodeURIComponent(word)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.sentences || [];
  },

  pronounceUrl: (word: string): string =>
    `${API_BASE_URL}/premium/pronounce/${encodeURIComponent(word)}`,

  exportCsvUrl: (): string => `${API_BASE_URL}/premium/export/csv`,

  exportAnkiUrl: (): string => `${API_BASE_URL}/premium/export/anki`,
};

// Auth API — just the pieces the stores need to refresh on cold-start.
export const authApi = {
  // Fetch the current user (including entitlements). Returns null on
  // network/auth failure so callers can fall through to cached state.
  me: async (): Promise<import('../types').User | null> => {
    try {
      const res = await authFetch(`${API_BASE_URL}/auth/me`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  // PATCH a subset of the profile (e.g. proficiency_level). Used so onboarding
  // can reconcile its derived starting level with the server profile the rest
  // of the app reads (UX audit F-003).
  updateProfile: async (patch: Record<string, unknown>): Promise<import('../types').User> => {
    const res = await authFetch(`${API_BASE_URL}/auth/me`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      // Surface the backend's reason ("Username already taken", …) so forms
      // can show it verbatim instead of a generic status code.
      const detail = await res.json().then((d) => d?.detail).catch(() => null);
      throw new Error(detail || `Failed to update profile (${res.status})`);
    }
    return res.json();
  },

  // Permanently delete the account + all server data (App Store 5.1.1(v) /
  // Play data-deletion policy). 204 on success; throws on failure so the
  // caller keeps the session intact and can surface the error.
  deleteAccount: async (): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/auth/me`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete account (${res.status})`);
  },
};

export const adminApi = {
  // Search users for the grant/revoke UI (email/username prefix match).
  searchUsers: async (q: string): Promise<Array<{
    id: number;
    email: string;
    username: string;
    is_admin: boolean;
    entitlements: import('../types').Entitlements;
  }>> => {
    const res = await authFetch(
      `${API_BASE_URL}/admin/users/search?q=${encodeURIComponent(q)}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/users/search → ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    return data.users || [];
  },

  // Grant Plus (comped by default). Returns the updated user row.
  grantPremium: async (body: {
    user_id?: number;
    email?: string;
    tier?: 'comped' | 'premium' | 'trial';
    expires_in_days?: number;
  }) => {
    const res = await authFetch(`${API_BASE_URL}/admin/users/grant-premium`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`grant-premium failed: ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  // Revoke Plus — drops user back to free + ads_eligible=true.
  revokePremium: async (userId: number) => {
    const res = await authFetch(
      `${API_BASE_URL}/admin/users/${userId}/revoke-premium`,
      { method: 'POST' }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`revoke-premium failed: ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  // Aggregate platform stats: movies/users/queue progress.
  stats: async (): Promise<AdminStats> => {
    const res = await authFetch(`${API_BASE_URL}/admin/stats`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/stats → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  // Processed movie browser, ordered by TMDB popularity desc. Pass `level`
  // to scope to a single CEFR difficulty bucket.
  processedMovies: async (level?: string): Promise<ProcessedMovie[]> => {
    const qs = level ? `?level=${encodeURIComponent(level)}` : '';
    const res = await authFetch(`${API_BASE_URL}/admin/movies/processed${qs}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/movies/processed → ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    return data.movies || [];
  },

  // Jobs that exhausted all script sources or crashed past the retry cap.
  deadJobs: async (): Promise<DeadJob[]> => {
    const res = await authFetch(`${API_BASE_URL}/admin/queue/dead`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/queue/dead → ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    return data.jobs || [];
  },

  // Health/coverage of the vocab pipeline (words → sentences → senses →
  // translations). Each metric carries an ok/warn/fail status; trend metrics
  // are diffed against the sentence worker's most recent daily snapshot.
  vocabCoverage: async (): Promise<VocabCoverageReport> => {
    const res = await authFetch(`${API_BASE_URL}/admin/health/vocab-coverage`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/health/vocab-coverage → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  // Hide a misspelled/bad word from every movie+book vocabulary list.
  // Admin-only; the server filters word_classification rows whose lowercased
  // form matches any hidden_words row.
  hideWord: async (word: string, reason?: string) => {
    const res = await authFetch(`${API_BASE_URL}/admin/hidden-words`, {
      method: 'POST',
      body: JSON.stringify({ word, reason }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /admin/hidden-words → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  unhideWord: async (word: string) => {
    const res = await authFetch(
      `${API_BASE_URL}/admin/hidden-words/${encodeURIComponent(word)}`,
      { method: 'DELETE' }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DELETE /admin/hidden-words → ${res.status} ${body.slice(0, 120)}`);
    }
    return res.json();
  },

  listHiddenWords: async (): Promise<Array<{
    id: number;
    word: string;
    reason: string | null;
    hidden_by: string | null;
    created_at: string | null;
  }>> => {
    const res = await authFetch(`${API_BASE_URL}/admin/hidden-words`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GET /admin/hidden-words → ${res.status} ${body.slice(0, 120)}`);
    }
    const data = await res.json();
    return data.hidden_words || [];
  },
};

// =====================================================================
// Feature Flags
// =====================================================================

// =====================================================================
// Billing / Subscriptions
// =====================================================================

interface SubscriptionStatus {
  tier: string;
  is_premium: boolean;
  expires_at: string | null;
  product_id?: string | null;
  platform?: string | null;
}

interface RestoreResult {
  restored: boolean;
  tier: string;
  message: string;
}

export const billingApi = {
  verifyAppleReceipt: async (receiptData: string, productId: string): Promise<SubscriptionStatus> => {
    const res = await authFetch(`${API_BASE_URL}/billing/apple/verify`, {
      method: 'POST',
      body: JSON.stringify({ receipt_data: receiptData, product_id: productId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Apple verify failed: ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  verifyGoogleReceipt: async (purchaseToken: string, productId: string): Promise<SubscriptionStatus> => {
    const res = await authFetch(`${API_BASE_URL}/billing/google/verify`, {
      method: 'POST',
      body: JSON.stringify({ purchase_token: purchaseToken, product_id: productId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google verify failed: ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  restorePurchases: async (): Promise<RestoreResult> => {
    const res = await authFetch(`${API_BASE_URL}/billing/restore`, { method: 'POST' });
    if (!res.ok) throw new Error('Restore failed');
    return res.json();
  },

  getStatus: async (): Promise<SubscriptionStatus> => {
    const res = await authFetch(`${API_BASE_URL}/billing/status`);
    if (!res.ok) throw new Error('Status check failed');
    return res.json();
  },
};

// =====================================================================
// Family Plan
// =====================================================================

export interface FamilyPlan {
  plan_id: number;
  owner_id: number;
  owner_email: string;
  max_members: number;
  members: Array<{ user_id: number; email: string; username: string; joined_at: string }>;
}

export const familyApi = {
  getPlan: async (): Promise<FamilyPlan | null> => {
    const res = await authFetch(`${API_BASE_URL}/family/plan`);
    if (!res.ok) return null;
    return res.json();
  },

  createPlan: async (): Promise<FamilyPlan> => {
    const res = await authFetch(`${API_BASE_URL}/family/create`, { method: 'POST' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Create family plan failed: ${res.status} ${text.slice(0, 120)}`);
    }
    return res.json();
  },

  inviteMember: async (email: string): Promise<{ success: boolean; message: string }> => {
    const res = await authFetch(`${API_BASE_URL}/family/invite`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || 'Invite failed');
    }
    return res.json();
  },

  removeMember: async (userId: number): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/family/remove/${userId}`, { method: 'POST' });
    if (!res.ok) throw new Error('Remove failed');
  },

  leave: async (): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/family/leave`, { method: 'POST' });
    if (!res.ok) throw new Error('Leave failed');
  },
};

// =====================================================================
// Gamification / Achievements
// =====================================================================

export interface Achievement {
  key: string;
  title: string;
  description: string | null;
  icon: string | null;
  category: string;
  threshold: number;
  progress: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export interface AchievementsResponse {
  achievements: Achievement[];
  total_unlocked: number;
  total_available: number;
}

interface NewlyUnlocked {
  key: string;
  title: string;
  icon: string | null;
}

export const achievementsApi = {
  getMyAchievements: async (): Promise<AchievementsResponse> => {
    const res = await authFetch(`${API_BASE_URL}/achievements/me`);
    if (!res.ok) throw new Error('Failed to load achievements');
    return res.json();
  },

  triggerCheck: async (): Promise<NewlyUnlocked[]> => {
    const res = await authFetch(`${API_BASE_URL}/achievements/check`, { method: 'POST' });
    if (!res.ok) return [];
    return res.json();
  },
};

// =====================================================================
// Social / Leaderboard
// =====================================================================

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  is_you: boolean;
}

export interface LeaderboardResponse {
  board: string;
  entries: LeaderboardEntry[];
  your_rank: number | null;
  your_score: number | null;
}

interface PublicProfile {
  user_id: number;
  username: string;
  profile_picture_url: string | null;
  words_saved: number;
  current_streak: number;
  longest_streak: number;
  total_reviews: number;
  achievements: Array<{ key: string; title: string; icon: string | null; unlocked_at: string | null }>;
}

export const socialApi = {
  leaderboardWords: async (): Promise<LeaderboardResponse> => {
    const res = await authFetch(`${API_BASE_URL}/social/leaderboard/words`);
    if (!res.ok) throw new Error('Failed to load leaderboard');
    return res.json();
  },

  leaderboardStreak: async (): Promise<LeaderboardResponse> => {
    const res = await authFetch(`${API_BASE_URL}/social/leaderboard/streak`);
    if (!res.ok) throw new Error('Failed to load leaderboard');
    return res.json();
  },

  leaderboardReviews: async (): Promise<LeaderboardResponse> => {
    const res = await authFetch(`${API_BASE_URL}/social/leaderboard/reviews`);
    if (!res.ok) throw new Error('Failed to load leaderboard');
    return res.json();
  },

  getProfile: async (userId: number): Promise<PublicProfile> => {
    const res = await authFetch(`${API_BASE_URL}/social/profile/${userId}`);
    if (!res.ok) throw new Error('Failed to load profile');
    return res.json();
  },
};

// =====================================================================
// Student Discount
// =====================================================================

interface StudentStatus {
  verified: boolean;
  method: string | null;
  discount_pct: number;
  verified_at: string | null;
}

export const studentApi = {
  getStatus: async (): Promise<StudentStatus> => {
    const res = await authFetch(`${API_BASE_URL}/student/status`);
    if (!res.ok) return { verified: false, method: null, discount_pct: 0, verified_at: null };
    return res.json();
  },

  verify: async (email: string, schoolName?: string): Promise<StudentStatus> => {
    const res = await authFetch(`${API_BASE_URL}/student/verify`, {
      method: 'POST',
      body: JSON.stringify({ email, school_name: schoolName }),
    });
    if (!res.ok) throw new Error('Verification failed');
    return res.json();
  },
};

// =====================================================================
// Quiz / Gamification
// =====================================================================

export type QuizCardType = 'mcq' | 'self_rate';
export type QuizSelfRating = 'know' | 'kinda' | 'dont';
export type QuizSessionKind = 'unit' | 'pre_movie' | 'batch';
export type QuizLeaderboardMetric = 'stars' | 'xp' | 'retention';

export interface QuizCard {
  word: string;
  card_type: QuizCardType;
  /** Canonical translation — the correct 'mcq' choice, echoed for
   *  callout copy. */
  translation: string | null;
  pos?: string | null;
  example_sentence?: string | null;
  /** MCQ choices: 4 translation entries, exactly one is_correct. */
  choices?: { word: string; is_correct: boolean }[] | null;
  cefr_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null;
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
  /** v0.7 §7.5 — frequency-weighted comprehension % of the session's
   *  movie, snapshotted before vs after SRS advance. Null for batch /
   *  cross-movie sessions where the per-movie figure doesn't apply. */
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
    const res = await authFetch(`${API_BASE_URL}/quiz/sessions`, {
      method: 'POST',
      body: JSON.stringify({ movie_id: movieId, level, kind }),
    });
    if (!res.ok) throw new Error('Failed to start quiz session');
    return res.json();
  },

  submitCards: async (
    sessionId: number,
    results: QuizCardResultInput[],
  ): Promise<{ stored: number }> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/sessions/${sessionId}/cards`, {
      method: 'POST',
      body: JSON.stringify({ results }),
    });
    if (!res.ok) throw new Error('Failed to submit quiz cards');
    return res.json();
  },

  completeSession: async (sessionId: number): Promise<QuizCompleteResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/sessions/${sessionId}/complete`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to complete quiz session');
    return res.json();
  },

  getMovieUnits: async (movieId: number): Promise<QuizUnitState[]> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/movies/${movieId}/units`);
    if (!res.ok) throw new Error('Failed to load quiz units');
    return res.json();
  },

  getBatchUnits: async (movieIds: number[]): Promise<QuizUnitState[]> => {
    const qs = encodeURIComponent(movieIds.join(','));
    const res = await authFetch(`${API_BASE_URL}/quiz/batch/units?movie_ids=${qs}`);
    if (!res.ok) throw new Error('Failed to load batch units');
    return res.json();
  },

  startBatchSession: async (
    movieIds: number[],
    level: string,
    kind: 'unit' | 'pre_movie' | 'batch' = 'batch',
  ): Promise<QuizStartSessionResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/batch/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movie_ids: movieIds, level, kind }),
    });
    if (!res.ok) {
      let msg = 'Failed to start batch session';
      try {
        const body = await res.json();
        if (body?.detail) msg = String(body.detail);
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  startJourneySession: async (
    level: string,
    tileIndex: number,
    wordsPerTile = 5,
    tmdbId?: number,
  ): Promise<QuizStartSessionResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/journey/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        tile_index: tileIndex,
        words_per_tile: wordsPerTile,
        ...(tmdbId != null ? { tmdb_id: tmdbId } : {}),
      }),
    });
    if (!res.ok) {
      let msg = 'Failed to start journey session';
      try {
        const body = await res.json();
        if (body?.detail) msg = String(body.detail);
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  startPreMovieQuiz: async (movieId: number): Promise<QuizStartSessionResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/pre-movie/${movieId}`, {
      method: 'POST',
    });
    if (!res.ok) {
      let msg = 'Failed to start pre-movie quiz';
      try {
        const body = await res.json();
        if (body?.detail) msg = String(body.detail);
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  getLeaderboard: async (
    metric: QuizLeaderboardMetric = 'stars',
    limit = 50,
  ): Promise<QuizLeaderboardEntry[]> => {
    const res = await authFetch(
      `${API_BASE_URL}/quiz/leaderboard?metric=${metric}&limit=${limit}`,
    );
    if (!res.ok) throw new Error('Failed to load quiz leaderboard');
    return res.json();
  },

  getMyRank: async (
    metric: QuizLeaderboardMetric = 'stars',
  ): Promise<QuizMyRankResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/leaderboard/me?metric=${metric}`);
    if (!res.ok) throw new Error('Failed to load rank');
    return res.json();
  },
};

// ─── Reel ────────────────────────────────────────────────────────────────
export type ReelTileSource = 'user' | 'suggested';

export interface ReelTile {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
  source: ReelTileSource;
  // v0.6 progress overlay. Backend defaults to 'unstudied'/0 for tiles
  // with no UserMovieProgress row yet, so these are always present.
  status?: 'unstudied' | 'studied' | 'mastered';
  comprehensibility_percent?: number;
  // v0.7: CEFR badge on the My Movies row + reel filtering. Null when
  // the user's added TMDB id has no matching catalog entry yet.
  cefr_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | null;
  // v0.7.2: internal Movie.id when we have a matching catalog row.
  // Required by the Movie Deep-Dive practice tile.
  movie_id?: number | null;
}

export interface ReelListResponse {
  tiles: ReelTile[];
  has_more: boolean;
}

/** Legacy alias kept for callers that imported the prior name. */
export type ReelMovieItem = ReelTile;

export interface ReelSeedResponse {
  seeded: number;
  tiles: ReelTile[];
}

export const reelApi = {
  list: async (cursor = 0, limit = 60): Promise<ReelListResponse> => {
    const res = await authFetch(`${API_BASE_URL}/reel?cursor=${cursor}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to load reel');
    return res.json();
  },

  add: async (input: {
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    year: number | null;
  }): Promise<ReelTile> => {
    const res = await authFetch(`${API_BASE_URL}/reel`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Failed to add to reel');
    return res.json();
  },

  remove: async (tmdbId: number): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/reel/${tmdbId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) throw new Error('Failed to remove from reel');
  },

  /** Idempotent first-launch bootstrap. Returns the user's reel; if it
   *  was empty, the server seeds a starter set in their CEFR band first. */
  seed: async (): Promise<ReelSeedResponse> => {
    const res = await authFetch(`${API_BASE_URL}/reel/seed`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to seed reel');
    return res.json();
  },
};

// ─── Lists ───────────────────────────────────────────────────────────────
// The Lists tab. A list holds films or words, never both. The two pinned
// lists are adapters server-side — `Saved from Home` reads/writes the reel
// and `Favourites` reads/writes the global saved-word rows — so the client
// treats every list uniformly and never needs to know which table backs it.

/** Domain error from /lists/*. `code` is the switchable value (e.g.
 *  `duplicate_name`, which the new-list sheet shows on its name field
 *  rather than as a toast); `message` is already user-facing. */
export class ListApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ListApiError';
    this.code = code;
    this.status = status;
  }
}

async function listsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(`${API_BASE_URL}/lists${path}`, init);
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let code = 'unknown';
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await res.json();
      const detail = body?.detail;
      if (detail && typeof detail === 'object') {
        code = detail.code ?? code;
        message = detail.message ?? message;
      } else if (typeof detail === 'string') {
        message = detail;
      }
    } catch {
      // Non-JSON body (gateway error, offline) — keep the generic message.
    }
    throw new ListApiError(code, message, res.status);
  }
  return res.json();
}

interface ListSummaryWire {
  id: number;
  name: string;
  kind: ListKind;
  system_key: ListSystemKey;
  count: number;
  due_count: number | null;
  total_words: number | null;
  preview: { posters: string[] | null; words: string[] | null };
  updated_at: string;
}

function toSummary(w: ListSummaryWire): ListSummary {
  return {
    id: w.id,
    name: w.name,
    kind: w.kind,
    systemKey: w.system_key ?? null,
    count: w.count,
    dueCount: w.due_count ?? null,
    totalWords: w.total_words ?? null,
    preview: {
      posters: w.preview?.posters ?? null,
      words: w.preview?.words ?? null,
    },
    updatedAt: w.updated_at,
  };
}

function toItem(kind: ListKind, raw: Record<string, unknown>): ListItem {
  if (kind === 'films') {
    return {
      tmdbId: raw.tmdb_id as number,
      title: raw.title as string,
      posterPath: (raw.poster_path as string | null) ?? null,
      year: (raw.year as number | null) ?? null,
      rating: (raw.rating as number | null) ?? null,
      cefr: (raw.cefr as string | null) ?? null,
      wordCount: (raw.word_count as number | null) ?? null,
      addedAt: raw.added_at as string,
    };
  }
  return {
    word: raw.word as string,
    lemmaId: (raw.lemma_id as number | null) ?? null,
    pos: (raw.pos as string | null) ?? null,
    cefr: (raw.cefr as string | null) ?? null,
    srsState: (raw.srs_state as ListWordItem['srsState']) ?? 'new',
    nextReviewAt: (raw.next_review_at as string | null) ?? null,
    addedAt: raw.added_at as string,
  };
}

export const listsApi = {
  list: async (kind?: ListKind): Promise<ListSummary[]> => {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    const res = await listsRequest<{ lists: ListSummaryWire[] }>(qs);
    return (res.lists ?? []).map(toSummary);
  },

  detail: async (
    id: number,
    opts: { limit?: number; cursor?: string | null; sort?: ListSort } = {},
  ): Promise<ListDetail> => {
    // RN's URLSearchParams polyfill lacks .set, so build the query by hand
    // (same reason as srsApi.startSession).
    const parts: string[] = [];
    if (opts.limit) parts.push(`limit=${opts.limit}`);
    if (opts.cursor) parts.push(`cursor=${encodeURIComponent(opts.cursor)}`);
    if (opts.sort) parts.push(`sort=${encodeURIComponent(opts.sort)}`);
    const qs = parts.length ? `?${parts.join('&')}` : '';
    const res = await listsRequest<{
      list: ListSummaryWire;
      items: Record<string, unknown>[];
      next_cursor: string | null;
    }>(`/${id}${qs}`);
    const summary = toSummary(res.list);
    return {
      summary,
      items: (res.items ?? []).map((i) => toItem(summary.kind, i)),
      nextCursor: res.next_cursor ?? null,
    };
  },

  create: async (name: string, kind: ListKind): Promise<ListSummary> =>
    toSummary(await listsRequest<ListSummaryWire>('', {
      method: 'POST',
      body: JSON.stringify({ name, kind }),
    })),

  rename: async (id: number, name: string): Promise<ListSummary> =>
    toSummary(await listsRequest<ListSummaryWire>(`/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })),

  remove: async (id: number): Promise<void> => {
    await listsRequest<void>(`/${id}`, { method: 'DELETE' });
  },

  /** Batch, so an Add-to-list multi-select is one round trip. Idempotent
   *  server-side, which is what lets the store retry safely. */
  addItems: async (
    id: number,
    payload: {
      films?: Array<{ tmdb_id: number; title: string; poster_path: string | null; year: number | null }>;
      words?: Array<{ word: string; lemma_id?: number | null }>;
    },
  ): Promise<ListSummary> =>
    toSummary(await listsRequest<ListSummaryWire>(`/${id}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })),

  /** `key` is the TMDB id for films, the word for words. */
  removeItem: async (id: number, key: number | string): Promise<void> => {
    await listsRequest<void>(`/${id}/items/${encodeURIComponent(String(key))}`, {
      method: 'DELETE',
    });
  },

  reorder: async (ids: number[]): Promise<void> => {
    await listsRequest<void>('/order', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
  },

  /** The gold action. Returns the standard session-start payload, so the
   *  review screen consumes it with no new parsing. Throws SrsPaywallError
   *  on 402 exactly as srsApi.startSession does — a free user who already
   *  did today's session hits the same cap here. */
  practice: async (id: number): Promise<SrsSessionStart> => {
    const res = await authFetch(`${API_BASE_URL}/lists/${id}/practice`, {
      method: 'POST',
    });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail ?? {};
      throw new SrsPaywallError(
        detail.message ?? 'Upgrade for unlimited sessions',
        detail.previews_used ?? 0,
        detail.previews_limit ?? 0,
        detail.paywall === 'srs_daily_cap_reached' ? 'daily_cap_reached' : 'preview_exhausted',
      );
    }
    if (!res.ok) {
      let code = 'unknown';
      let message = 'Something went wrong. Please try again.';
      try {
        const body = await res.json();
        const detail = body?.detail;
        if (detail && typeof detail === 'object') {
          code = detail.code ?? code;
          message = detail.message ?? message;
        }
      } catch {
        // keep the generic message
      }
      throw new ListApiError(code, message, res.status);
    }
    return res.json();
  },
};

// ─── Watched list + Not-interested (home-feed swipe actions) ─────────────
// Swipe right on a home-feed card → Watched list; swipe left → hidden. Both
// are excluded server-side from /movies/by-cefr so they never resurface.
export interface WatchedMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  year: number | null;
}

interface WatchedListResponse {
  movies: WatchedMovie[];
}

export const watchedApi = {
  list: async (): Promise<WatchedMovie[]> => {
    const res = await authFetch(`${API_BASE_URL}/movies/watched`);
    if (!res.ok) throw new Error('Failed to load watched list');
    const data: WatchedListResponse = await res.json();
    return data.movies;
  },

  markWatched: async (input: {
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    year: number | null;
  }): Promise<WatchedMovie> => {
    const res = await authFetch(`${API_BASE_URL}/movies/watched`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Failed to mark watched');
    return res.json();
  },

  unmarkWatched: async (tmdbId: number): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/movies/watched/${tmdbId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Failed to remove from watched');
  },

  hide: async (tmdbId: number): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/movies/hidden`, {
      method: 'POST',
      body: JSON.stringify({ tmdb_id: tmdbId }),
    });
    if (!res.ok && res.status !== 204) throw new Error('Failed to hide movie');
  },

  unhide: async (tmdbId: number): Promise<void> => {
    const res = await authFetch(`${API_BASE_URL}/movies/hidden/${tmdbId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Failed to unhide movie');
  },
};

// ─── Ready-to-Watch (v0.6 discovery surface) ─────────────────────────────
export interface ReadyToWatchMovie {
  movie_id: number;
  tmdb_id: number | null;
  title: string;
  poster_url: string | null;
  year: number | null;
  comprehensibility_percent: number;
  status: 'unstudied' | 'studied';
}

export interface ReadyToWatchResponse {
  movies: ReadyToWatchMovie[];
  floor_pct: number;
  total: number;
}

export const readyToWatchApi = {
  /** "Movies you can probably understand now" — ranks non-reel movies by
   *  the user's UserMovieProgress.comprehensibility_percent desc, floor
   *  defaulting to 40%. Empty list is a normal early-days state. */
  list: async (limit = 5, floorPct = 40): Promise<ReadyToWatchResponse> => {
    const res = await authFetch(
      `${API_BASE_URL}/movies/ready-to-watch?limit=${limit}&floor_pct=${floorPct}`,
    );
    if (!res.ok) throw new Error('Failed to load ready-to-watch');
    return res.json();
  },
};

export { API_BASE_URL };

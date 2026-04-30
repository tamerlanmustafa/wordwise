import { config } from '../config/env';
import { tokenStorage } from './auth/tokenStorage';

// Use centralized config for API URL
const API_BASE_URL = config.API_URL;

// TMDB API Key (same as web app)
const TMDB_API_KEY = '9dece7a38786ac0c58794d6db4af3d51';

// Types
export interface TMDBMovie {
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

export interface TMDBMetadata {
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

export interface ScriptResponse {
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

export interface TranslationResponse {
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

// Helper for authenticated requests
const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
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
};

// WordWise API
export const wordwiseApi = {
  // Search for movies with scripts
  searchMovies: async (query: string): Promise<MovieSearchResponse> => {
    const res = await fetch(`${API_BASE_URL}/api/scripts/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Failed to search movies');
    return res.json();
  },

  // Fetch script for a movie
  fetchScript: async (
    scriptId: string,
    movieTitle?: string,
    tmdbId?: number,
  ): Promise<ScriptResponse> => {
    const res = await fetch(`${API_BASE_URL}/api/scripts/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  // Classify movie vocabulary with CEFR levels
  classifyVocabulary: async (movieId: number, targetLanguage: string = 'ES', genres?: string[]): Promise<VocabularyResponse> => {
    const res = await fetch(`${API_BASE_URL}/api/cefr/classify-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  getMoviesByCefr: async (level: string, limit: number = 50): Promise<{
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
      vote_average: number | null;
      vote_count: number | null;
    }>;
  }> => {
    const res = await fetch(
      `${API_BASE_URL}/movies/by-cefr?level=${encodeURIComponent(level)}&limit=${limit}`
    );
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

  // Translate text
  translate: async (
    text: string,
    targetLang: string,
    userId?: number,
    movieId?: number | null
  ): Promise<TranslationResponse> => {
    const body: Record<string, unknown> = {
      text,
      target_lang: targetLang,
      source_lang: 'auto',
      user_id: userId,
    };
    if (movieId) body.movie_id = movieId;

    const res = await fetch(`${API_BASE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
}

export interface SrsSessionStart {
  cards: SrsReviewCard[];
  total_due: number;
  session_size: number;
  is_preview: boolean;
  previews_remaining: number;
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
  definition: string | null;
  example_sentence: string | null;
  movie_title: string;
  movie_poster_url: string | null;
  cefr_level: string | null;
  movie_id: number;
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

// Thrown when /srs/session/start returns 402 (preview budget exhausted).
// The session screen catches this and pushes the paywall screen instead.
export class SrsPaywallError extends Error {
  previews_used: number;
  previews_limit: number;
  constructor(message: string, previews_used: number, previews_limit: number) {
    super(message);
    this.name = 'SrsPaywallError';
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

  startSession: async (): Promise<SrsSessionStart> => {
    const res = await authFetch(`${API_BASE_URL}/srs/session/start`, {
      method: 'POST',
    });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      const detail = body?.detail || {};
      throw new SrsPaywallError(
        detail.message || 'Free review sessions used up',
        detail.previews_used ?? 0,
        detail.previews_limit ?? 0
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

  todaysWord: async (): Promise<TodaysWord | null> => {
    const res = await authFetch(`${API_BASE_URL}/srs/today`);
    if (!res.ok) return null;
    const body = await res.json();
    return body || null;
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

export interface FeatureFlag {
  flag_key: string;
  enabled: boolean;
  variant: string | null;
}

export const flagsApi = {
  getMyFlags: async (): Promise<FeatureFlag[]> => {
    const res = await authFetch(`${API_BASE_URL}/flags/me`);
    if (!res.ok) return [];
    return res.json();
  },
};

// =====================================================================
// Billing / Subscriptions
// =====================================================================

export interface SubscriptionStatus {
  tier: string;
  is_premium: boolean;
  expires_at: string | null;
  product_id?: string | null;
  platform?: string | null;
}

export interface RestoreResult {
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

export interface NewlyUnlocked {
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

export interface PublicProfile {
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

export interface StudentStatus {
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

export type QuizCardType = 'type' | 'self_rate';
export type QuizSelfRating = 'know' | 'kinda' | 'dont';
export type QuizSessionKind = 'unit' | 'pre_movie' | 'batch';
export type QuizLeaderboardMetric = 'stars' | 'xp' | 'retention';

export interface QuizCard {
  word: string;
  card_type: QuizCardType;
  translation: string | null;
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
  ): Promise<QuizStartSessionResponse> => {
    const res = await authFetch(`${API_BASE_URL}/quiz/journey/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, tile_index: tileIndex, words_per_tile: wordsPerTile }),
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

export { API_BASE_URL };

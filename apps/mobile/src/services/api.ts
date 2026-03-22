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
    const token = await tokenStorage.getAccessToken();
    console.log('[API] getAuthToken result:', token ? `${token.substring(0, 30)}...` : 'null');
    return token;
  } catch (err) {
    console.log('[API] getAuthToken error:', err);
    return null;
  }
};

// Helper for authenticated requests
const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const token = await getAuthToken();
  console.log('[API] authFetch called for:', url);
  console.log('[API] Token available:', !!token);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    console.log('[API] Authorization header set');
  } else {
    console.log('[API] WARNING: No token, request will be unauthenticated');
  }

  const response = await fetch(url, { ...options, headers });
  console.log('[API] Response status:', response.status);
  return response;
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
  fetchScript: async (scriptId: string, movieTitle?: string): Promise<ScriptResponse> => {
    const res = await fetch(`${API_BASE_URL}/api/scripts/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script_id: scriptId,
        movie_title: movieTitle,
        force_refresh: false,
      }),
    });
    if (!res.ok) throw new Error('Failed to fetch script');
    return res.json();
  },

  // Classify movie vocabulary with CEFR levels
  classifyVocabulary: async (movieId: number, targetLanguage: string = 'ES'): Promise<VocabularyResponse> => {
    const res = await fetch(`${API_BASE_URL}/api/cefr/classify-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        movie_id: movieId,
        save_to_db: true,
        target_language: targetLanguage,
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
    console.log('[API] getVocabularyFull called for movie:', movieId);
    const res = await authFetch(`${API_BASE_URL}/movies/${movieId}/vocabulary/full`);
    if (!res.ok) {
      const errorText = await res.text();
      console.log('[API] getVocabularyFull failed:', res.status, errorText);
      throw new Error(`Failed to get vocabulary: ${res.status}`);
    }
    console.log('[API] getVocabularyFull succeeded');
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
    userId?: number
  ): Promise<TranslationResponse> => {
    const res = await fetch(`${API_BASE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        target_lang: targetLang,
        source_lang: 'auto',
        user_id: userId,
      }),
    });
    if (!res.ok) throw new Error('Failed to translate');
    return res.json();
  },
};

export { API_BASE_URL };

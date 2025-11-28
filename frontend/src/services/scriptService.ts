import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface MovieSearchResult {
  id: string;  // STANDS4 script ID
  title: string;
  year: string;
  subtitle: string;  // Description/tagline
  author: string;    // Writer/director
  genre: string;
  link: string;
}

export interface TMDBMetadata {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;  // Full image URL
  overview: string;
  genres: string[];
  popularity: number;
}

export interface MovieSearchResponse {
  query: string;
  results: MovieSearchResult[];
  total: number;
  tmdb_metadata: TMDBMetadata | null;  // TMDB metadata for UI display only
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
    script_id?: string;
    link?: string;
  };
  fetched_at: string | null;
}

export interface CEFRClassificationResponse {
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
    [level: string]: Array<{
      word: string;
      lemma: string;
      confidence: number;
      frequency_rank: number | null;
    }>;
  };
}

export interface TranslationRequest {
  text: string;
  target_lang: string;
  source_lang?: string;
  user_id?: number;
}

export interface TranslationResponse {
  source: string;
  translated: string;
  target_lang: string;
  source_lang: string | null;
  cached: boolean;
  provider?: string | null;
  created_at?: string;
}

export interface BatchTranslationRequest {
  texts: string[];
  target_lang: string;
  source_lang?: string;
  user_id?: number;
}

export interface BatchTranslationResponse {
  results: TranslationResponse[];
  total: number;
  cached_count: number;
  api_calls: number;
}

export interface TranslationCacheStats {
  total_translations: number;
  languages: Record<string, number>;
  cache_enabled: boolean;
}

export interface DifficultWord {
  word: string;
  target_lang: string;
  translation: string;
  attempt_count: number;
  first_translated: string;
  last_translated: string;
  providers_used: string[];
}

export interface DifficultWordsResponse {
  words: DifficultWord[];
  total: number;
  min_attempts: number;
}

export interface UserTranslationStats {
  user_id: number;
  total_translations: number;
  unique_words: number;
  languages: Record<string, number>;
  providers: Record<string, number>;
  most_recent: string | null;
}

/**
 * Search for movies matching a query.
 * Returns ALL matching movies so the user can select the exact one.
 */
export async function searchMovies(query: string): Promise<MovieSearchResponse> {
  console.log('[API REQUEST] /api/scripts/search?query=', query);

  try {
    const response = await axios.get<MovieSearchResponse>(
      `${API_BASE_URL}/api/scripts/search`,
      {
        params: { query }
      }
    );

    console.log('[API RESPONSE - SEARCH]', {
      query: response.data.query,
      total: response.data.total,
      results: response.data.results.length
    });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - SEARCH]', error);
    throw error;
  }
}

/**
 * Fetch script using a specific STANDS4 script ID.
 * This ensures we get the EXACT movie the user selected.
 */
export async function fetchMovieScriptById(scriptId: string, movieTitle?: string): Promise<ScriptResponse> {
  console.log('[API REQUEST] /api/scripts/fetch - script_id:', scriptId);

  try {
    const response = await axios.post<ScriptResponse>(
      `${API_BASE_URL}/api/scripts/fetch`,
      {
        script_id: scriptId,
        movie_title: movieTitle,
        force_refresh: false
      }
    );

    // console.log('[API RESPONSE - SCRIPT]', {
    //   source: response.data.source_used,
    //   words: response.data.word_count,
    //   from_cache: response.data.from_cache,
    //   title: response.data.metadata.title
    // });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - FETCH SCRIPT]', error);
    throw error;
  }
}

/**
 * @deprecated Use searchMovies() and fetchMovieScriptById() instead
 *
 * Old function that directly fetches by title.
 * This can return the WRONG movie (e.g., "Titanic" → "National Geographic: Secrets of the Titanic")
 */
export async function fetchMovieScript(movieTitle: string): Promise<ScriptResponse> {
  console.log('[API REQUEST] /api/scripts/fetch -', movieTitle);

  try {
    const response = await axios.post<ScriptResponse>(
      `${API_BASE_URL}/api/scripts/fetch`,
      {
        movie_title: movieTitle,
        force_refresh: false
      }
    );

    // console.log('[API RESPONSE - SCRIPT]', {
    //   source: response.data.source_used,
    //   words: response.data.word_count,
    //   from_cache: response.data.from_cache,
    //   title: response.data.metadata.title
    // });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - FETCH SCRIPT]', error);
    throw error;
  }
}

/**
 * Classify movie script using CEFR classifier
 * This endpoint:
 * 1. Retrieves the script from database
 * 2. Classifies all words using hybrid CEFR classifier
 * 3. Saves classifications to database
 * 4. Returns level distribution and top words per level
 */
export async function classifyMovieScript(movieId: number): Promise<CEFRClassificationResponse> {
  // console.log('[API REQUEST] /api/cefr/classify-script - movie_id:', movieId);

  try {
    const response = await axios.post<CEFRClassificationResponse>(
      `${API_BASE_URL}/api/cefr/classify-script`,
      {
        movie_id: movieId,
        save_to_db: true
      }
    );

    // console.log('[API RESPONSE - CEFR CLASSIFICATION]', {
    //   total_words: response.data.total_words,
    //   unique_words: response.data.unique_words,
    //   average_confidence: response.data.average_confidence,
    //   wordlist_coverage: response.data.wordlist_coverage
    // });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - CLASSIFY SCRIPT]', error);
    throw error;
  }
}

/**
 * Get vocabulary preview (PUBLIC - no auth required).
 * Returns only 3 sample words from each CEFR level, no translations.
 */
export async function getVocabularyPreview(movieId: number): Promise<CEFRClassificationResponse> {
  try {
    const response = await axios.get<CEFRClassificationResponse>(
      `${API_BASE_URL}/movies/${movieId}/vocabulary/preview`
    );
    return response.data;
  } catch (error) {
    console.error('[API ERROR - VOCABULARY PREVIEW]', error);
    throw error;
  }
}

/**
 * Get full vocabulary (PROTECTED - auth required).
 * Returns all words with CEFR levels, supports translations.
 */
export async function getVocabularyFull(movieId: number, token: string): Promise<CEFRClassificationResponse> {
  try {
    const response = await axios.get<CEFRClassificationResponse>(
      `${API_BASE_URL}/movies/${movieId}/vocabulary/full`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('[API ERROR - VOCABULARY FULL]', error);
    throw error;
  }
}

/**
 * Translate text to target language using DeepL or Google Translate
 * Automatically caches translations to minimize API calls
 * Tracks user translation attempts when userId is provided
 */
export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto',
  userId?: number
): Promise<TranslationResponse> {
  console.log('[API REQUEST] /translate -', text, '→', targetLang, userId ? `(user: ${userId})` : '');

  try {
    const response = await axios.post<TranslationResponse>(
      `${API_BASE_URL}/translate`,
      {
        text,
        target_lang: targetLang,
        source_lang: sourceLang,
        user_id: userId
      }
    );

    console.log('[API RESPONSE - TRANSLATION]', {
      translated: response.data.translated,
      cached: response.data.cached,
      provider: response.data.provider,
      source_lang: response.data.source_lang
    });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - TRANSLATE]', error);
    throw error;
  }
}

/**
 * Translate multiple texts in a single request
 * More efficient than individual translations
 * Tracks user translation attempts when userId is provided
 */
export async function translateBatch(
  texts: string[],
  targetLang: string,
  sourceLang: string = 'auto',
  userId?: number
): Promise<BatchTranslationResponse> {
  console.log('[API REQUEST] /translate/batch -', texts.length, 'texts →', targetLang, userId ? `(user: ${userId})` : '');
  console.log('[DEBUG] First 5 texts:', texts.slice(0, 5));
  console.log('[DEBUG] All texts:', texts);

  try {
    const response = await axios.post<BatchTranslationResponse>(
      `${API_BASE_URL}/translate/batch`,
      {
        texts,
        target_lang: targetLang,
        source_lang: sourceLang,
        user_id: userId
      }
    );

    console.log('[API RESPONSE - BATCH TRANSLATION]', {
      total: response.data.total,
      cached: response.data.cached_count,
      api_calls: response.data.api_calls
    });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - BATCH TRANSLATE]', error);
    throw error;
  }
}

/**
 * Get translation cache statistics
 */
export async function getTranslationCacheStats(): Promise<TranslationCacheStats> {
  console.log('[API REQUEST] /translate/cache/stats');

  try {
    const response = await axios.get<TranslationCacheStats>(
      `${API_BASE_URL}/translate/cache/stats`
    );

    console.log('[API RESPONSE - CACHE STATS]', response.data);
    return response.data;
  } catch (error) {
    console.error('[API ERROR - CACHE STATS]', error);
    throw error;
  }
}

/**
 * Get words that user has translated multiple times (indicating difficulty)
 * Helps identify which words are harder for the user to learn
 */
export async function getUserDifficultWords(
  userId: number,
  targetLang?: string,
  minAttempts: number = 2,
  limit: number = 50
): Promise<DifficultWordsResponse> {
  console.log('[API REQUEST] /translate/user/${userId}/difficult-words');

  try {
    const params: any = { min_attempts: minAttempts, limit };
    if (targetLang) {
      params.target_lang = targetLang;
    }

    const response = await axios.get<DifficultWordsResponse>(
      `${API_BASE_URL}/translate/user/${userId}/difficult-words`,
      { params }
    );

    console.log('[API RESPONSE - DIFFICULT WORDS]', {
      total: response.data.total,
      words: response.data.words.length
    });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - DIFFICULT WORDS]', error);
    throw error;
  }
}

/**
 * Get user's translation statistics
 * Returns overview of translation activity, languages used, and providers
 */
export async function getUserTranslationStats(
  userId: number,
  targetLang?: string
): Promise<UserTranslationStats> {
  console.log('[API REQUEST] /translate/user/${userId}/stats');

  try {
    const params: any = {};
    if (targetLang) {
      params.target_lang = targetLang;
    }

    const response = await axios.get<UserTranslationStats>(
      `${API_BASE_URL}/translate/user/${userId}/stats`,
      { params }
    );

    console.log('[API RESPONSE - USER STATS]', response.data);

    return response.data;
  } catch (error) {
    console.error('[API ERROR - USER STATS]', error);
    throw error;
  }
}

/**
 * Check translation service health
 */
export async function checkTranslationHealth(): Promise<{
  status: string;
  api_configured: boolean;
  plan: string;
  mock_mode: boolean;
  message: string;
}> {
  try {
    const response = await axios.get(`${API_BASE_URL}/translate/health`);
    return response.data;
  } catch (error) {
    console.error('[API ERROR - TRANSLATION HEALTH]', error);
    throw error;
  }
}

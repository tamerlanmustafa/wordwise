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

export interface MovieSearchResponse {
  query: string;
  results: MovieSearchResult[];
  total: number;
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

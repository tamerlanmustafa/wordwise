import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
 * Fetch and analyze movie script using the new ingestion system
 * This endpoint:
 * 1. Searches for the movie
 * 2. Downloads and extracts the script from STANDS4 PDF
 * 3. Saves to database
 * 4. Returns the full script text
 */
export async function fetchMovieScript(movieTitle: string): Promise<ScriptResponse> {
  console.log('[API REQUEST] /api/scripts/fetch -', movieTitle);

  try {
    const response = await axios.post<ScriptResponse>(
      `${API_BASE_URL}/api/scripts/fetch`,
      {
        movie_title: movieTitle,
        force_refresh: false // Use cached version if available
      }
    );

    console.log('[API RESPONSE - SCRIPT]', {
      source: response.data.source_used,
      words: response.data.word_count,
      from_cache: response.data.from_cache,
      title: response.data.metadata.title
    });

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
  console.log('[API REQUEST] /api/cefr/classify-script - movie_id:', movieId);

  try {
    const response = await axios.post<CEFRClassificationResponse>(
      `${API_BASE_URL}/api/cefr/classify-script`,
      {
        movie_id: movieId,
        save_to_db: true
      }
    );

    console.log('[API RESPONSE - CEFR CLASSIFICATION]', {
      total_words: response.data.total_words,
      unique_words: response.data.unique_words,
      average_confidence: response.data.average_confidence,
      wordlist_coverage: response.data.wordlist_coverage
    });

    return response.data;
  } catch (error) {
    console.error('[API ERROR - CLASSIFY SCRIPT]', error);
    throw error;
  }
}

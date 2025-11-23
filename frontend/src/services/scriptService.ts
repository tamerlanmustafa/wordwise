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

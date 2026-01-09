// User types
export interface User {
  id: number;
  email: string;
  username: string;
  profile_picture_url: string | null;
  native_language: string | null;
  learning_language: string | null;
  proficiency_level: string | null;
  default_tab: 'movies' | 'books';
  is_admin: boolean;
}

// Movie types
export interface Movie {
  id: number;
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  overview: string | null;
  genres: string[];
  difficulty_level: string | null;
  difficulty_score: number | null;
  word_count: number | null;
}

export interface MovieSearchResult {
  id: number;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string | null;
}

export interface MovieSearchResponse {
  results: MovieSearchResult[];
  page: number;
  total_pages: number;
  total_results: number;
}

// Book types
export interface Book {
  id: number;
  gutenberg_id: number;
  title: string;
  author: string | null;
  year: number | null;
  cover_url: string | null;
  difficulty_level: string | null;
  difficulty_score: number | null;
  word_count: number | null;
}

// Vocabulary types
export interface Word {
  id: number;
  word: string;
  cefr_level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  frequency_rank: number | null;
  translation: string | null;
  definition: string | null;
  example_sentence: string | null;
  phonetic: string | null;
  part_of_speech: string | null;
  is_saved: boolean;
}

export interface WordListResponse {
  words: Word[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface SavedWord extends Word {
  saved_at: string;
  movie_id: number | null;
  book_id: number | null;
  notes: string | null;
}

// Auth types
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// KEEP IN SYNC with packages/types/src/index.ts. See constants.ts for rationale.

export interface Entitlements {
  tier: 'free' | 'trial' | 'premium' | 'comped';
  is_premium: boolean;
  is_admin: boolean;
  ads_eligible: boolean;
  subscription_expires_at: string | null;
}

export * from './constants';

import type { CefrLevel } from './constants';

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
  /** App UI locale pinned in Settings, mirrored to the account so a new
   *  install inherits it and emails go out in it. Optional because the user
   *  objects the login screens assemble by hand don't carry it. */
  language_preference?: string | null;
  /** Whether this ACCOUNT has finished onboarding. Was an AsyncStorage flag,
   *  so a second device replayed the whole first-run flow. Optional because
   *  the login screens assemble user objects by hand and an older server does
   *  not send it — both read as "no opinion", never as "not onboarded". */
  onboarding_completed?: boolean;
  /** Explore CEFR mix chosen on this account: six bands summing to 100.
   *  `null`/absent means never set, so the client derives one from the level. */
  feed_level_mix?: Record<string, number> | null;
  entitlements?: Entitlements | null;
}

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

export interface Word {
  id: number;
  word: string;
  cefr_level: CefrLevel;
  frequency_rank: number | null;
  translation: string | null;
  definition: string | null;
  example_sentence: string | null;
  phonetic: string | null;
  part_of_speech: string | null;
  is_saved: boolean;
}


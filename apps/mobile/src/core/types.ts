// App-scoped types shared by App.tsx and extracted screen components.

export type Screen =
  | 'home'
  | 'movieDetail'
  | 'searchResults'
  | 'settings'
  | 'admin'
  | 'review'
  | 'paywall'
  | 'stats'
  | 'notebook'
  | 'lists'
  | 'achievements'
  | 'leaderboard'
  | 'familyPlan'
  | 'privacy'
  | 'terms'
  | 'learnedWords'
  | 'vocabulary'
  | 'quizJourney'
  | 'quizLesson'
  | 'quizResult'
  | 'quizBatchBuilder'
  | 'quizBatchJourney'
  | 'journey'
  | 'addToReel';

export type ListFilter = 'saved' | 'learned';

// TMDB-shaped movie with optional fields our backend sometimes supplies
// (e.g. when enriching by-level results). Used across Search/Home/Detail.
export interface MovieData {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date: string;
  overview?: string;
  genre_ids?: number[];
  vote_average?: number;
  original_language?: string;
  tmdb_id?: number;
}

// TMDB genre ID -> display name (canonical list of the genres we surface).
export const tmdbGenres: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

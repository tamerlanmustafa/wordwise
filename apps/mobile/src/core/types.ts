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
  | 'watched'
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
  // Legacy 'journey' screen state is unreachable from the v0.7 nav,
  // but kept in the union so any legacy navigation paths still typecheck
  // until they're cleaned up. App.tsx no longer routes anything here.
  | 'journey'
  | 'movies'
  | 'practice'
  | 'moviePreview'
  | 'setIntro'
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


// App-scoped types shared by App.tsx and extracted screen components.

export type Screen =
  | 'home'
  /** The account area's front door. Was a bottom sheet until 2026-09-05; it is
   *  a tab root now, which is why `PROFILE_SHEET` no longer exists. */
  | 'profile'
  | 'notificationSettings'
  | 'account'
  | 'legal'
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
  | 'explore'
  /** The saved reel, now reached from the Profile sheet rather than a tab. */
  | 'savedMovies'
  /** An open list inside the Lists tab. The tab stays lit while it shows. */
  | 'listDetail'
  | 'practice'
  | 'moviePreview'
  | 'setIntro'
  | 'addToReel';

export type ListFilter = 'saved' | 'learned';

// ─── Lists tab ───────────────────────────────────────────────────────────
// A list holds films or words, never both. That constraint is what lets a
// row honestly preview its contents and keeps the Practice handoff
// unambiguous. camelCase here; the API layer maps from the wire's
// snake_case so components never see two conventions.

export type ListKind = 'films' | 'words';

/** `null` for user-created lists. The two non-null keys are the pinned
 *  lists — undeletable, unrenameable, and rendered from `lists.system.*`
 *  so their names localise. */
export type ListSystemKey = 'reel' | 'favourites' | null;

export interface ListSummary {
  id: number;
  name: string;
  kind: ListKind;
  systemKey: ListSystemKey;
  count: number;
  /** Words lists only — members due for review right now. */
  dueCount: number | null;
  /** Films lists only — combined vocabulary size of its films. */
  totalWords: number | null;
  /** At most 3, in list order. Exactly one side is populated, per `kind`. */
  preview: { posters: string[] | null; words: string[] | null };
  updatedAt: string;
}

export interface ListFilmItem {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  year: number | null;
  rating: number | null;
  cefr: string | null;
  wordCount: number | null;
  addedAt: string;
}

export type ListWordSrsState = 'new' | 'learning' | 'due' | 'learned';

export interface ListWordItem {
  word: string;
  lemmaId: number | null;
  pos: string | null;
  cefr: string | null;
  /** `new` covers "added from Explore, never studied" — a legitimate state,
   *  not missing data. */
  srsState: ListWordSrsState;
  nextReviewAt: string | null;
  addedAt: string;
}

export type ListItem = ListFilmItem | ListWordItem;

export interface ListDetail {
  summary: ListSummary;
  items: ListItem[];
  nextCursor: string | null;
}

export type ListSort = 'added' | 'title' | 'rating' | 'due' | 'alpha';

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
  /**
   * Average colour of the backdrop's top-right patch, `[r, g, b]` (#115).
   * Supplied by /movies/by-cefr, not by TMDB, so it is present only on rows
   * that came from our own feed. The home card reads it via
   * `cardVisuals.cornerForGlyph` to pick legible ink for the add glyph.
   */
  backdrop_corner_rgb?: [number, number, number] | null;
}


// WordWise — Home / RankedMovieList sample data.
// Real TMDB poster + backdrop paths (verified IDs), same shape the app
// consumes from /movie/top_rated + the difficulty classifier.
window.WW_HOME_DATA = {
  userLevel: 'B1',

  // B1-level ranked feed — sorted by rating desc by default.
  movies: [
    { id: 238, tmdb_id: 238, title: 'The Godfather',
      poster_path: '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',
      backdrop_path: '/tmU7GeKVybMWFButWEGl2M4GeiP.jpg',
      vote_average: 8.7, vote_count: 19500, difficulty_score: 62, unique_words: 4218 },
    { id: 278, tmdb_id: 278, title: 'The Shawshank Redemption',
      poster_path: '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',
      backdrop_path: '/kXfqcdQKsToO0OUXHcrrNCHDBzO.jpg',
      vote_average: 8.7, vote_count: 27000, difficulty_score: 58, unique_words: 4881 },
    { id: 240, tmdb_id: 240, title: 'The Godfather Part II',
      poster_path: '/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg',
      backdrop_path: '/kGzFbGhp99zva6oZODW5atUtnqi.jpg',
      vote_average: 8.6, vote_count: 11700, difficulty_score: 65, unique_words: 4520 },
    { id: 424, tmdb_id: 424, title: "Schindler's List",
      poster_path: '/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg',
      backdrop_path: '/zb6fM1CX41D9rF9hdgclu0peUmy.jpg',
      vote_average: 8.6, vote_count: 14800, difficulty_score: 60, unique_words: 4112 },
    { id: 129, tmdb_id: 129, title: 'Spirited Away',
      poster_path: '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg',
      backdrop_path: '/Ab8mkHmkYADjU7wQiOkia9BzGvS.jpg',
      vote_average: 8.5, vote_count: 16800, difficulty_score: 48, unique_words: 2103 },
    { id: 497, tmdb_id: 497, title: 'The Green Mile',
      poster_path: '/velWPhVMQeQKcxggNEU8YmIo52R.jpg',
      backdrop_path: '/l6hQWH9eDksNJNiXWYRkWqikOdu.jpg',
      vote_average: 8.5, vote_count: 17900, difficulty_score: 54, unique_words: 4310 },
    { id: 389, tmdb_id: 389, title: '12 Angry Men',
      poster_path: '/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg',
      backdrop_path: '/qqHQsStV6exghCM7zbObuYBiYxw.jpg',
      vote_average: 8.5, vote_count: 7900, difficulty_score: 56, unique_words: 2890 },
    { id: 19404, tmdb_id: 19404, title: 'Dilwale Dulhania Le Jayenge',
      poster_path: '/ktejodbcdCPXbMMdnpI9BUxW6O8.jpg',
      backdrop_path: '/90ez6ArvpO8bvpyIngBuwXOqJm5.jpg',
      vote_average: 8.5, vote_count: 4500, difficulty_score: 52, unique_words: 3221 },
  ],

  levelOptions: [
    { value: 'A1', label: 'A1 · Beginner' },
    { value: 'A2', label: 'A2 · Elementary' },
    { value: 'B1', label: 'B1 · Intermediate' },
    { value: 'B2', label: 'B2 · Upper-Int.' },
    { value: 'C1', label: 'C1 · Advanced' },
    { value: 'C2', label: 'C2 · Proficiency' },
  ],

  // Autocomplete results for query "the dark"
  searchSuggestions: [
    { id: 155,    title: 'The Dark Knight',       release_date: '2008-07-16', poster_path: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
    { id: 49026,  title: 'The Dark Knight Rises',  release_date: '2012-07-16', poster_path: '/hr0L2aueqlP2BYUblTTjmtn0hw4.jpg' },
    { id: 272,    title: 'Batman Begins',          release_date: '2005-06-10', poster_path: '/8RW2runSEc34IwKN2D1aPcJd2UL.jpg' },
    { id: 530385, title: 'Midsommar',              release_date: '2019-07-03', poster_path: '/7LEI8ulZzO5gy9Ww2NVCrKmHeDZ.jpg' },
  ],
  searchSuggestionsTotal: 23,

  todaysWord: {
    word: 'redemption',
    pos: 'noun',
    movie_title: 'The Shawshank Redemption',
    movie_id: 278,
    definition: 'the action of being saved from sin, error, or evil; deliverance.',
    example_sentence: 'Get busy living, or get busy dying. The path to redemption begins with hope.',
  },

  lastOpenedMovie: {
    id: 278, title: 'The Shawshank Redemption',
    poster_path: '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',
    progress: 38,
  },
};

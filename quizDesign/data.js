// Shared data for the WordWise tabs template — real TMDB poster paths
// so the screens render with believable density.

window.WW_TABS_DATA = (function () {
  const M = (id, title, year, director, runtime, level, poster, progress, addedDays, words, wordsKnown, rating) => ({
    id, title, year, director, runtime, level, poster, progress, addedDays, words, wordsKnown, rating,
  });

  const movies = [
    M(496243, 'Parasite',                         2019, 'Bong Joon-ho',    '2h 12m', 'B2', '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', 72, 2,   142, 102, 8.5),
    M(1018494, 'Past Lives',                      2023, 'Celine Song',     '1h 45m', 'B1', '/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg', 100, 5, 78, 78, 7.9),
    M(680,    'Pulp Fiction',                     1994, 'Q. Tarantino',    '2h 34m', 'C1', '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg',  18, 8,   210, 38, 8.5),
    M(155,    'The Dark Knight',                  2008, 'C. Nolan',        '2h 32m', 'B2', '/qJ2tW6WMUDux911r6m7haRef0WH.jpg',  44, 14,  168, 74, 8.5),
    M(545611, 'Everything Everywhere All At Once',2022, 'Daniels',         '2h 19m', 'B2', '/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg',  31, 21,  186, 58, 7.8),
    M(129,    'Spirited Away',                    2001, 'H. Miyazaki',     '2h 5m',  'A2', '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg',  88, 30,  92,  81, 8.5),
    M(278,    'The Shawshank Redemption',         1994, 'F. Darabont',     '2h 22m', 'B1', '/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg',  6,  1,   154, 9,  8.7),
    M(238,    'The Godfather',                    1972, 'F.F. Coppola',    '2h 55m', 'C1', '/3bhkrj58Vtu7enYsRolD1fZdja1.jpg',  0,  0,   228, 0,  8.7),
    M(637,    'Life Is Beautiful',                1997, 'R. Benigni',      '1h 56m', 'B1', '/74hLDKjD5aGYOotO6esUVaeISa2.jpg',  100, 90, 132, 132, 8.5),
    M(1359977, 'Conclave',                        2024, 'E. Berger',       '2h 0m',  'C1', '/gv8PD1vGnHfZGbKCWHGOT6IXtxL.jpg',  12, 4,   164, 19, 7.4),
  ];

  // Practice "path" = a sequence of movie units, each with 5 lesson nodes.
  // states: done | active | locked.  kinds: recall | mcq | listen | chest | star
  const units = [
    {
      id: 'u-parasite',
      movieId: 496243,
      title: 'Parasite',
      poster: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
      level: 'B2',
      done: 4, total: 5,
      tagline: 'Class & survival',
      lessons: [
        { id: 'p1', kind: 'recall',  state: 'done',   label: 'Words 1–5'   },
        { id: 'p2', kind: 'mcq',     state: 'done',   label: 'Synonyms'    },
        { id: 'p3', kind: 'recall',  state: 'done',   label: 'Words 6–10'  },
        { id: 'p4', kind: 'listen',  state: 'active', label: 'In context'  },
        { id: 'p5', kind: 'chest',   state: 'locked', label: 'Final cut'   },
      ],
    },
    {
      id: 'u-past-lives',
      movieId: 1018494,
      title: 'Past Lives',
      poster: '/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
      level: 'B1',
      done: 0, total: 5,
      tagline: 'Memory & longing',
      lessons: [
        { id: 'l1', kind: 'recall',  state: 'locked', label: 'Words 1–5'   },
        { id: 'l2', kind: 'mcq',     state: 'locked', label: 'Synonyms'    },
        { id: 'l3', kind: 'recall',  state: 'locked', label: 'Words 6–10'  },
        { id: 'l4', kind: 'listen',  state: 'locked', label: 'In context'  },
        { id: 'l5', kind: 'star',    state: 'locked', label: 'Mastery'     },
      ],
    },
  ];

  return { movies, units };
})();

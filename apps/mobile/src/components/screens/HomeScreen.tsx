import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlobalBottomBar } from '../GlobalBottomBar';
import { FloatingContinueButton } from '../FloatingContinueButton';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AVAILABLE_LANGUAGES } from '../../types';
import { colors } from '../../theme/palette';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';
import {
  wordwiseApi,
  tmdbApi,
  srsApi,
  API_BASE_URL,
  type TodaysWord,
} from '../../services/api';
import { useEntitlementsStore, useShowAds } from '../../stores/entitlementsStore';
import { RankedMovieList } from '../home/RankedMovieList';
import { SnapPager } from '../home/SnapPager';
import { LEVEL_OPTIONS } from '../home/filterOptions';

interface Props {
  onLogout: () => void;
  onMoviePress: (movie: MovieData) => void;
  onSearch: (query: string) => void;
  user: any;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  onNavigateToSettings: () => void;
  onNavigateToAdmin: () => void;
  onNavigateToReview: () => void;
  onNavigateToStats: () => void;
  onNavigateToNotebook: () => void;
  onNavigateToLists: () => void;
  onNavigateToAchievements: () => void;
  onNavigateToLeaderboard: () => void;
  onNavigateToVocabulary: () => void;
  onNavigateToBatchJourney?: () => void;
  onNavigateToProfile?: () => void;
}

export const HomeScreen = ({
  onLogout,
  onMoviePress,
  onSearch,
  user,
  targetLanguage,
  setTargetLanguage,
  onNavigateToSettings,
  onNavigateToAdmin,
  onNavigateToReview,
  onNavigateToStats,
  onNavigateToNotebook,
  onNavigateToLists,
  onNavigateToAchievements,
  onNavigateToLeaderboard,
  onNavigateToVocabulary,
  onNavigateToBatchJourney,
  onNavigateToProfile,
}: Props) => {
  const adminViewMode = useEntitlementsStore((s) => s.adminViewMode);
  const showViewAsBadge = !!user?.is_admin && adminViewMode !== 'admin';
  const showAdsEntitlement = useShowAds();
  const [isFirstSession, setIsFirstSession] = useState(true);
  const showAds = showAdsEntitlement && !isFirstSession;
  const [activeTab] = useState<'movies' | 'books'>('movies');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trendingMovies, setTrendingMovies] = useState<any[]>([]);
  const [topRatedMovies, setTopRatedMovies] = useState<any[]>([]);
  const [homeTab, setHomeTab] = useState<'level' | 'trending'>('level');
  const [tabSwitching, setTabSwitching] = useState(false);
  const [levelSort, setLevelSort] = useState<'rating' | 'popularity' | 'level'>('rating');
  const [levelSortAsc, setLevelSortAsc] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(user?.proficiency_level || 'B1');
  const [levelDropdownOpen, setLevelDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [srsDueCount, setSrsDueCount] = useState<number | null>(null);
  const [srsTotalSaved, setSrsTotalSaved] = useState(0);
  const [todaysWord, setTodaysWord] = useState<TodaysWord | null>(null);
  const [todaysWordSaved, setTodaysWordSaved] = useState(false);
  const [lastOpenedMovie, setLastOpenedMovie] = useState<any | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('last_opened_movie')
      .then((raw) => {
        if (!raw) return;
        try { setLastOpenedMovie(JSON.parse(raw)); } catch {}
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('has_opened_before').then((val) => {
      if (val) setIsFirstSession(false);
      else AsyncStorage.setItem('has_opened_before', '1');
    });

    srsApi.stats().then((s) => {
      setSrsDueCount(s.due_now);
      setSrsTotalSaved(s.total_saved);
    }).catch(() => {});
    srsApi.todaysWord().then(setTodaysWord).catch(() => {});
  }, []);

  const fetchLevelMovies = async (level: string) => {
    try {
      const levelRes = await fetch(`${API_BASE_URL}/movies/by-cefr?level=${level}&limit=15`);
      if (levelRes.ok) {
        const levelData = await levelRes.json();
        const raw = (levelData.movies || []).map((m: any) => ({
          ...m,
          id: m.tmdb_id || m.movie_id,
        }));
        const enriched = await Promise.all(
          raw.map(async (m: any) => {
            if (!m.tmdb_id) return m;
            try {
              const r = await fetch(`https://api.themoviedb.org/3/movie/${m.tmdb_id}?api_key=9dece7a38786ac0c58794d6db4af3d51`);
              const t = await r.json();
              return {
                ...m,
                overview: t.overview || m.description || '',
                poster_path: t.poster_path || null,
                backdrop_path: t.backdrop_path || null,
                release_date: t.release_date || (m.year ? `${m.year}-01-01` : ''),
              };
            } catch { return m; }
          })
        );
        setTopRatedMovies(enriched);
      }
    } catch {}
  };

  useEffect(() => {
    (async () => {
      try {
        const trendingRes = await fetch('https://api.themoviedb.org/3/trending/movie/day?api_key=9dece7a38786ac0c58794d6db4af3d51');
        const trendingData = await trendingRes.json();
        setTrendingMovies(trendingData.results?.slice(0, 15) || []);
        await fetchLevelMovies(selectedLevel);
      } catch (error) {
        console.error('Failed to fetch movies:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSearchTextChange = (text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (text.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await tmdbApi.searchMovies(text.trim());
        setSuggestions(results.slice(0, 5));
        setAllResults(results);
        setShowSuggestions(true);
      } catch (err) {
        console.error('Autocomplete failed:', err);
      }
    }, 300);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSuggestions([]);
    setAllResults([]);
    setShowSuggestions(false);
  };

  const handleMoviePress = (movie: any) => {
    const normalized = {
      id: movie.id || movie.tmdb_id || movie.movie_id,
      tmdb_id: movie.tmdb_id || (typeof movie.id === 'number' ? movie.id : undefined),
      title: movie.title,
      poster_path: movie.poster_path,
      backdrop_path: movie.backdrop_path,
      release_date: movie.release_date || (movie.year ? `${movie.year}-01-01` : undefined),
      overview: movie.overview || movie.description,
      genre_ids: movie.genre_ids,
      vote_average: movie.vote_average,
      original_language: movie.original_language || 'en',
    };
    setLastOpenedMovie(normalized);
    AsyncStorage.setItem('last_opened_movie', JSON.stringify(normalized)).catch(() => {});
    onMoviePress(normalized);
  };

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === targetLanguage) || AVAILABLE_LANGUAGES[0];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>

        <View style={styles.searchContainer}>
          <View style={styles.searchInputWrapper}>
            <TextInput
              style={styles.searchInput}
              placeholder={activeTab === 'movies' ? 'Search movies...' : 'Search books...'}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={onSearchTextChange}
              onSubmitEditing={() => { if (searchQuery.trim()) { onSearch(searchQuery.trim()); clearSearch(); } }}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={clearSearch} style={styles.searchClear}>
                <Text style={styles.searchClearText}>✕</Text>
              </TouchableOpacity>
            )}
            {showSuggestions && suggestions.length > 0 && (
              <View style={styles.autocompleteDropdown}>
                {suggestions.map((movie: any) => (
                  <TouchableOpacity
                    key={movie.id}
                    style={styles.searchResultItem}
                    onPress={() => {
                      handleMoviePress(movie);
                      clearSearch();
                    }}
                    activeOpacity={0.7}
                  >
                    {movie.poster_path ? (
                      <Image
                        source={{ uri: `https://image.tmdb.org/t/p/w92${movie.poster_path}` }}
                        style={styles.searchResultPoster}
                      />
                    ) : (
                      <View style={[styles.searchResultPoster, { backgroundColor: colors.border }]} />
                    )}
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultTitle} numberOfLines={1}>{movie.title}</Text>
                      <Text style={styles.searchResultYear}>{movie.release_date?.slice(0, 4)}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {allResults.length > 5 && (
                  <TouchableOpacity
                    style={styles.seeAllButton}
                    onPress={() => {
                      onSearch(searchQuery.trim());
                      clearSearch();
                    }}
                  >
                    <Text style={styles.seeAllText}>See all {allResults.length} results</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => { if (searchQuery.trim()) { onSearch(searchQuery.trim()); clearSearch(); } }}
          >
            <Text style={styles.searchButtonText}>🔍</Text>
          </TouchableOpacity>
        </View>


        {showAds && (
          <View style={styles.adBanner}>
            <Text style={styles.adBannerText}>Ad</Text>
          </View>
        )}


        <View style={{ zIndex: 50, overflow: 'visible' }}>
          <View style={styles.homeTabToggleWrapper}>
            <TouchableOpacity
              style={[styles.homeTabToggleBtn, homeTab === 'level' && styles.homeTabToggleBtnActive]}
              onPress={() => {
                if (homeTab === 'level') {
                  setLevelDropdownOpen((v) => !v);
                } else {
                  setTabSwitching(true);
                  setHomeTab('level');
                  setLevelDropdownOpen(false);
                  setTimeout(() => setTabSwitching(false), 400);
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.homeTabToggleText, homeTab === 'level' && styles.homeTabToggleTextActive]}>
                {selectedLevel === (user?.proficiency_level || 'B1')
                  ? `⭐ Your Level (${selectedLevel})`
                  : `⭐ Level ${selectedLevel}`}
                {homeTab === 'level' ? ` ${levelDropdownOpen ? '▲' : '▼'}` : ''}
              </Text>
            </TouchableOpacity>
            {/* Journey tab — disabled until feature is ready. */}
            <View style={[styles.homeTabToggleBtn, { opacity: 0.4 }]}>
              <Text style={styles.homeTabToggleText}>🎮 Journey</Text>
              <Text style={{ fontSize: 9, color: '#A0A0B0', fontWeight: '700', marginTop: 1 }}>Soon</Text>
            </View>
          </View>

          {levelDropdownOpen && (
            <View style={[styles.levelPickerMenu, { left: 16 }]}>
              {LEVEL_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.levelPickerItem, opt.value === selectedLevel && styles.levelPickerItemActive]}
                  onPress={async () => {
                    setLevelDropdownOpen(false);
                    if (opt.value !== selectedLevel) {
                      setSelectedLevel(opt.value);
                      setTabSwitching(true);
                      await fetchLevelMovies(opt.value);
                      setTabSwitching(false);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.levelPickerIcon}>{opt.icon}</Text>
                  <Text style={[styles.levelPickerText, opt.value === selectedLevel && styles.levelPickerTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

        </View>

        {homeTab === 'level' && (
          <View style={styles.levelSortRow}>
            {([
              { key: 'rating' as const, label: 'Rating' },
              { key: 'popularity' as const, label: 'Popularity' },
              { key: 'level' as const, label: 'Level %' },
            ]).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.levelSortChip, levelSort === opt.key && styles.levelSortChipActive]}
                onPress={() => {
                  if (levelSort === opt.key) {
                    setLevelSortAsc((v) => !v);
                  } else {
                    setLevelSort(opt.key);
                    setLevelSortAsc(false);
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.levelSortText, levelSort === opt.key && styles.levelSortTextActive]}>
                  {opt.label} {levelSort === opt.key ? (levelSortAsc ? '↑' : '↓') : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.section}>
          {loading || tabSwitching ? (
            <View style={styles.skeletonContainer}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <View style={styles.skeletonPoster} />
                  <View style={styles.skeletonInfo}>
                    <View style={[styles.skeletonLine, { width: '70%' }]} />
                    <View style={[styles.skeletonLine, { width: '40%', marginTop: 8 }]} />
                  </View>
                </View>
              ))}
            </View>
          ) : homeTab === 'level' ? (
            <RankedMovieList
              movies={[...topRatedMovies].sort((a, b) => {
                let diff = 0;
                if (levelSort === 'rating') diff = (b.vote_average || 0) - (a.vote_average || 0);
                else if (levelSort === 'popularity') diff = (b.vote_count || 0) - (a.vote_count || 0);
                else diff = (a.difficulty_score || 0) - (b.difficulty_score || 0);
                return levelSortAsc ? -diff : diff;
              })}
              onMoviePress={handleMoviePress}
              userLevel={selectedLevel}
            />
          ) : (
            <SnapPager
              movies={trendingMovies}
              onMoviePress={handleMoviePress}
            />
          )}
        </View>

        {todaysWord && (
          <View style={styles.todayCard}>
            <View style={styles.todayHeader}>
              <Text style={styles.todayLabel}>Today's Word</Text>
              <Text style={styles.todayMovie}>from {todaysWord.movie_title}</Text>
            </View>
            <Text style={styles.todayWord}>{todaysWord.word}</Text>
            {todaysWord.definition && (
              <Text style={styles.todayDef}>{todaysWord.definition}</Text>
            )}
            {todaysWord.example_sentence && (
              <Text style={styles.todaySentence}>"{todaysWord.example_sentence}"</Text>
            )}
            <TouchableOpacity
              style={[styles.todaySaveBtn, todaysWordSaved && styles.todaySaveBtnSaved]}
              onPress={async () => {
                if (todaysWordSaved) return;
                try {
                  await wordwiseApi.saveWord(todaysWord.word, todaysWord.movie_id);
                  setTodaysWordSaved(true);
                  setSrsTotalSaved((n) => n + 1);
                } catch {}
              }}
            >
              <Text style={[styles.todaySaveBtnText, todaysWordSaved && styles.todaySaveBtnTextSaved]}>
                {todaysWordSaved ? '★ Saved' : '☆ Save this word'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <TouchableOpacity
            style={styles.browseAllButton}
            onPress={() => onSearch('')}
            activeOpacity={0.7}
          >
            <Text style={styles.browseAllText}>Browse All Movies →</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      {lastOpenedMovie && (
        <FloatingContinueButton
          movie={lastOpenedMovie}
          onPress={() => handleMoviePress(lastOpenedMovie)}
        />
      )}

      <GlobalBottomBar
        active="home"
        onTabPress={(t) => {
          if (t === 'words') onNavigateToLists();
          else if (t === 'rankings') onNavigateToLeaderboard();
          else if (t === 'journey') onNavigateToBatchJourney?.();
          else if (t === 'profile') onNavigateToProfile?.();
        }}
      />
    </SafeAreaView>
  );
};

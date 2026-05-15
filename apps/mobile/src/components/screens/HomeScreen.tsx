import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Keyboard,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../theme/tokens';
import { GlobalBottomBar } from '../GlobalBottomBar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AVAILABLE_LANGUAGES } from '../../types';
import { colors } from '../../theme/palette';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';
import {
  tmdbApi,
  srsApi,
  API_BASE_URL,
  type TodaysWord,
} from '../../services/api';
import { useEntitlementsStore, useShowAds } from '../../stores/entitlementsStore';
import { RankedMovieList } from '../home/RankedMovieList';
import { SnapPager } from '../home/SnapPager';
import { LEVEL_OPTIONS } from '../home/filterOptions';
import { TodayWordCard, TodayWordCardSkeleton } from '../home/TodayWordCard';

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
  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
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
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SEARCH_BAR_H = 66;
  const searchBarAnim = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const searchBarVisible = useRef(true);

  const handleScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    if (y < SEARCH_BAR_H) {
      if (!searchBarVisible.current) {
        searchBarVisible.current = true;
        Animated.timing(searchBarAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      }
      return;
    }
    if (dy > 3 && searchBarVisible.current) {
      searchBarVisible.current = false;
      Animated.timing(searchBarAnim, { toValue: -SEARCH_BAR_H, duration: 200, useNativeDriver: true }).start();
    } else if (dy < -3 && !searchBarVisible.current) {
      searchBarVisible.current = true;
      Animated.timing(searchBarAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('recently_viewed_movies');
        if (raw) {
          setRecentlyViewed(JSON.parse(raw));
          return;
        }
        // Migrate from old single-movie key
        const lastRaw = await AsyncStorage.getItem('last_opened_movie');
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          setRecentlyViewed([last]);
          AsyncStorage.setItem('recently_viewed_movies', JSON.stringify([last])).catch(() => {});
        }
      } catch {}
    })();
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
  }, []);

  // Today's word is cached per-day per-language inside srsApi.todaysWord, so
  // this effect is a no-op on tab switches and only hits the network when the
  // user changes their translation language (or the date rolls over).
  useEffect(() => {
    srsApi.todaysWord(0, targetLanguage).then(setTodaysWord).catch(() => {});
  }, [targetLanguage]);

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
    AsyncStorage.setItem('last_opened_movie', JSON.stringify(normalized)).catch(() => {});
    setRecentlyViewed((prev) => {
      const filtered = prev.filter((m) => String(m.id) !== String(normalized.id));
      const updated = [normalized, ...filtered].slice(0, 8);
      AsyncStorage.setItem('recently_viewed_movies', JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    onMoviePress(normalized);
  };

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === targetLanguage) || AVAILABLE_LANGUAGES[0];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['top']}>

      <Animated.View style={[styles.searchBarFixed, { top: insets.top, backgroundColor: tc.background, transform: [{ translateY: searchBarAnim }] }]}>
        <View style={styles.searchContainer}>
          <Text style={styles.searchBrandLabel}>WW</Text>
          <View style={styles.searchInputWrapper}>
            <TextInput
              style={styles.searchInput}
              placeholder={activeTab === 'movies' ? 'Search movies...' : 'Search books...'}
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={onSearchTextChange}
              onFocus={() => {
                if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                setSearchFocused(true);
              }}
              onBlur={() => {
                blurTimerRef.current = setTimeout(() => setSearchFocused(false), 200);
              }}
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
            {searchFocused && !searchQuery && recentlyViewed.length > 0 && (
              <View style={styles.autocompleteDropdown}>
                <Text style={styles.recentlyViewedLabel}>Recently Viewed</Text>
                {recentlyViewed.slice(0, 5).map((movie: any) => (
                  <TouchableOpacity
                    key={movie.id}
                    style={styles.searchResultItem}
                    onPress={() => {
                      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                      setSearchFocused(false);
                      handleMoviePress(movie);
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
      </Animated.View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { Keyboard.dismiss(); setSearchFocused(false); }}
        onScroll={handleScroll}
        contentContainerStyle={{ paddingTop: SEARCH_BAR_H }}
      >

        {showAds && (
          <View style={styles.adBanner}>
            <Text style={styles.adBannerText}>Ad</Text>
          </View>
        )}

        {todaysWord ? (
          <TodayWordCard
            word={todaysWord}
            targetLanguage={targetLanguage}
          />
        ) : (
          <TodayWordCardSkeleton />
        )}

        <View style={{ zIndex: 50, overflow: 'visible' }}>
          <View style={styles.levelSortRow}>
            <TouchableOpacity
              style={[styles.levelSortChip, styles.levelSortChipActive]}
              onPress={() => setLevelDropdownOpen((v) => !v)}
              activeOpacity={0.7}
            >
              <Text style={styles.levelSortTextActive}>
                {selectedLevel === (user?.proficiency_level || 'B1')
                  ? `⭐ ${selectedLevel}`
                  : `⭐ ${selectedLevel}`}{' '}
                {levelDropdownOpen ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>
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

        <View style={{ height: 16 }} />
      </ScrollView>

      {(searchFocused && !searchQuery && recentlyViewed.length > 0) && (
        <TouchableOpacity
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }}
          activeOpacity={1}
          onPress={() => { Keyboard.dismiss(); setSearchFocused(false); }}
        />
      )}

    </SafeAreaView>
  );
};

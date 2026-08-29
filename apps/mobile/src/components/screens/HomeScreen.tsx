import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MovieData } from '../../core/types';
import {
  tmdbApi,
  srsApi,
  watchedApi,
  type TodaysWord,
} from '../../services/api';
import { showToast } from '../../stores/toastStore';
import { useNotificationsStore } from '../../stores/notificationsStore';
import type { SwipeAction } from '../../utils/swipeDecision';
import { useShowAds } from '../../stores/entitlementsStore';
import { RankedMovieList } from '../home/RankedMovieList';
import { SnapPager } from '../home/SnapPager';
import { TodayWordCard, TodayWordCardSkeleton } from '../home/TodayWordCard';
import { FeedSkeleton } from '../common/FeedSkeleton';
import { HomeHeader } from '../home/HomeHeader';
import { HomeSearchBar } from '../home/HomeSearchBar';
import { FeedFilterSheet } from '../home/FeedFilterSheet';
import { LevelSheet } from '../home/LevelSheet';
import {
  DEFAULT_FEED_FILTERS,
  MOVIE_TYPE_OPTIONS,
  activeFilterCount,
  type LevelSort,
  type MovieType,
} from '../home/filterOptions';
import { useFeedLevel } from '../../hooks/useFeedLevel';
import { useInfiniteCefrMovies } from '../../hooks/useInfiniteCefrMovies';
import { reduceCollapse, initialCollapseState, type CollapseState } from '../../utils/collapseOnScroll';

// The Word-of-the-Hour card is HIDDEN on Home but kept intact so we can bring
// it back: flip this to true to restore the card, its hourly re-fetch and the
// scroll-collapse animation. Everything below stays wired to this one flag.
const SHOW_WORD_OF_THE_HOUR: boolean = false;

// Full laid-out height of the Word-of-the-Hour block: the card's own
// marginTop (4) + CARD_HEIGHT (152) + marginBottom (16). Collapsing this to 0
// lets the feed below slide up to fill the reclaimed space.
const WORD_BLOCK_H = 172;

interface Props {
  onMoviePress: (movie: MovieData) => void;
  onSearch: (query: string) => void;
  user: any;
  targetLanguage: string;
  /** Height the floating bottom bar reserves, so the feed's last row can
   *  scroll clear of the glass. */
  bottomOffset?: number;
}

// Deep-screen navigation (Stats, Lists, Settings, Leaderboard, …) now lives in
// the Profile sheet (UserMenuSheet), not a Home menu — the pre-v0.7 Home menu
// was removed in the 4-tab refactor, so those callbacks were dead here and have
// been dropped (UX audit F-030).
export const HomeScreen = ({
  onMoviePress,
  onSearch,
  user,
  targetLanguage,
  bottomOffset = 0,
}: Props) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  // The bell moved to the Profile sheet, but its unread state is still primed
  // from here: Home is the first screen mounted, so refreshing on its mount is
  // what makes the dot meaningful before the menu is ever opened.
  useEffect(() => {
    void useNotificationsStore.getState().refresh();
  }, []);
  const s = useMemo(() => makeStyles(tc), [tc]);
  const showAdsEntitlement = useShowAds();
  const [isFirstSession, setIsFirstSession] = useState(true);
  const showAds = showAdsEntitlement && !isFirstSession;
  const [homeTab] = useState<'level' | 'trending'>('level');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [allResults, setAllResults] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [trendingMovies, setTrendingMovies] = useState<any[]>([]);
  const [levelSort, setLevelSort] = useState<LevelSort>(DEFAULT_FEED_FILTERS.sort);
  const [levelSortAsc, setLevelSortAsc] = useState(DEFAULT_FEED_FILTERS.sortAsc);
  // Animation vs live action (#114). In-memory like the sort above — neither
  // persists across a remount, and a filter that outlives the session would be
  // a separate decision for both of them, not just this one.
  const [movieType, setMovieType] = useState<MovieType>(DEFAULT_FEED_FILTERS.movieType);
  // The level is not in that group: it's owned by the profile, so it re-syncs
  // when `proficiency_level` changes instead of freezing at its mount value.
  const [selectedLevel, setSelectedLevel] = useFeedLevel(user?.proficiency_level);
  // Which sheet is up, if any — they share the screen, so only one at a time.
  const [openSheet, setOpenSheet] = useState<'none' | 'filters' | 'level'>('none');

  // Server-sorted, paginated CEFR feed for the ranked list. The backend does
  // the ordering, so each sort/level reflects the full catalog (not a reshuffle
  // of one page) and the list scrolls infinitely with per-page TMDB enrichment.
  const {
    movies: levelMovies,
    loading: levelLoading,
    loadingMore: levelLoadingMore,
    hasMore: levelHasMore,
    loadMore: loadMoreLevel,
    removeMovie: removeLevelMovie,
    insertMovie: insertLevelMovie,
  } = useInfiniteCefrMovies(
    selectedLevel,
    levelSort,
    levelSortAsc ? 'asc' : 'desc',
    movieType,
  );
  const [loading, setLoading] = useState(true);
  const [todaysWord, setTodaysWord] = useState<TodaysWord | null>(null);
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Word-of-the-Hour collapse: as the user scrolls the ranked movie feed down,
  // the card snaps up out of view (0 → 1); scrolling back up ~one row springs
  // it back (reduceCollapse) — no need to return to the very top. Direction runs
  // absorb momentum jitter so it doesn't flicker.
  const wordCollapse = useRef(new Animated.Value(0)).current;
  const collapseStateRef = useRef<CollapseState>(initialCollapseState);
  const handleFeedScroll = useCallback(
    (offsetY: number) => {
      // Nothing to collapse while the card is hidden.
      if (!SHOW_WORD_OF_THE_HOUR) return;
      const prev = collapseStateRef.current;
      const next = reduceCollapse(prev, offsetY);
      collapseStateRef.current = next;
      if (next.collapsed === prev.collapsed) return;
      Animated.timing(wordCollapse, {
        toValue: next.collapsed ? 1 : 0,
        duration: next.collapsed ? 240 : 300,
        easing: Easing.out(Easing.cubic),
        // height/opacity animation isn't supported by the native driver.
        useNativeDriver: false,
      }).start();
    },
    [wordCollapse],
  );

  // A new level/sort re-queries the feed and snaps it back to the top, but the
  // list may not emit an onScroll(0) for that reset — so bring the card back
  // explicitly to avoid it getting stuck collapsed.
  useEffect(() => {
    collapseStateRef.current = initialCollapseState;
    wordCollapse.setValue(0);
  }, [selectedLevel, levelSort, levelSortAsc, movieType, wordCollapse]);

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
  }, []);

  // Word of the hour is cached per-hour per-language inside srsApi.todaysWord,
  // so this is a no-op on tab switches and only hits the network when the user
  // changes their translation language or the clock hour rolls over. The timer
  // re-fetches at the top of each (UTC) hour so the card rotates even while the
  // screen stays mounted.
  useEffect(() => {
    // The card is hidden, so don't spend a request (or an hourly timer) on it.
    if (!SHOW_WORD_OF_THE_HOUR) return;
    let timeout: ReturnType<typeof setTimeout>;
    const load = () => {
      srsApi.todaysWord(0, targetLanguage).then(setTodaysWord).catch(() => {});
      const msToNextHour = 3600_000 - (Date.now() % 3600_000);
      timeout = setTimeout(load, msToNextHour + 1000);
    };
    load();
    return () => clearTimeout(timeout);
  }, [targetLanguage]);

  // Trending tab data. The level tab's feed is owned by useInfiniteCefrMovies.
  const loadTrending = useCallback(async () => {
    try {
      const trending = await tmdbApi.getTrending();
      setTrendingMovies(trending.slice(0, 15));
    } catch (error) {
      console.error('Failed to fetch movies:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrending();
  }, [loadTrending]);

  // Pull-to-refresh (Motion §E5) — branded gold RefreshControl. Re-pulls the
  // trending feed and today's word; the level feed owns its own refresh.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadTrending(),
        SHOW_WORD_OF_THE_HOUR
          ? srsApi.todaysWord(0, targetLanguage).then(setTodaysWord).catch(() => {})
          : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [loadTrending, targetLanguage]);

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

  const submitSearch = () => {
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
      clearSearch();
    }
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

  const onSearchMoviePress = (movie: any) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setSearchFocused(false);
    handleMoviePress(movie);
    clearSearch();
  };

  // Home-feed swipe: right → "Seen it" (Watched list), left → "Not
  // interested" (hidden). Optimistically remove the card, fire the API, and
  // offer Undo — which reverses the API call and drops the card back where it
  // was. Both actions are excluded from the server feed so they won't return.
  const handleSwipeAction = useCallback(
    (action: SwipeAction, movie: any) => {
      const tmdbId = movie?.tmdb_id ?? (typeof movie?.id === 'number' ? movie.id : undefined);
      if (!tmdbId) return;

      const index = removeLevelMovie(tmdbId);
      if (index === -1) return;

      const year = movie.release_date
        ? parseInt(String(movie.release_date).slice(0, 4), 10)
        : movie.year ?? null;

      if (action === 'watched') {
        watchedApi
          .markWatched({
            tmdb_id: tmdbId,
            title: movie.title,
            poster_path: movie.poster_path ?? null,
            year,
          })
          .catch(() => {});
        showToast({
          message: `Added “${movie.title}” to Watched`,
          tone: 'success',
          actionLabel: 'Undo',
          onAction: () => {
            watchedApi.unmarkWatched(tmdbId).catch(() => {});
            insertLevelMovie(movie, index);
          },
        });
      } else {
        watchedApi.hide(tmdbId).catch(() => {});
        showToast({
          message: `Hidden “${movie.title}”`,
          actionLabel: 'Undo',
          onAction: () => {
            watchedApi.unhide(tmdbId).catch(() => {});
            insertLevelMovie(movie, index);
          },
        });
      }
    },
    [removeLevelMovie, insertLevelMovie],
  );

  const handleSortPress = (key: LevelSort) => {
    if (levelSort === key) {
      setLevelSortAsc((v) => !v);
    } else {
      setLevelSort(key);
      setLevelSortAsc(false);
    }
  };

  const dropdownOpen = (showSuggestions && suggestions.length > 0) ||
    (searchFocused && !searchQuery && recentlyViewed.length > 0);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Warm hero glow behind the top ~240px, matching the other tabs. */}
      <LinearGradient
        colors={[tc.heroGlowStart, 'transparent']}
        locations={[0, 1]}
        style={s.glow}
        pointerEvents="none"
      />

      <HomeHeader
        level={selectedLevel}
        onLevelPress={() => setOpenSheet('level')}
      />

      {/* The header stack (search + ad + collapsible word card + filters) is
          pinned; the movie feed below is the page's sole scroller. Scrolling
          the feed collapses the Word-of-the-Hour card away and springs it back
          at the top — so the whole view becomes search + filters + movies. */}
      <View style={s.headerStack}>
        {/* Search — paper field with autocomplete dropdown. zIndex keeps the
            dropdown above the ad slot / controls below it. */}
        <View style={s.searchLayer}>
          <HomeSearchBar
            query={searchQuery}
            onChangeText={onSearchTextChange}
            onSubmit={submitSearch}
            onClear={clearSearch}
            focused={searchFocused}
            onFocus={() => {
              if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
              setSearchFocused(true);
            }}
            onBlur={() => {
              blurTimerRef.current = setTimeout(() => setSearchFocused(false), 200);
            }}
            suggestions={suggestions}
            allResultsCount={allResults.length}
            showSuggestions={showSuggestions}
            recentlyViewed={recentlyViewed}
            onMoviePress={onSearchMoviePress}
            onSeeAll={submitSearch}
            onFilterPress={() => setOpenSheet('filters')}
            activeFilters={activeFilterCount({
              sort: levelSort,
              sortAsc: levelSortAsc,
              movieType,
            })}
          />
        </View>

        {/* Ad slot — chipBg fill, 1px dashed border, centered ADVERTISEMENT.
            Hidden while the search dropdown is open. */}
        {showAds && !dropdownOpen ? (
          <View style={s.adSlot}>
            <Text style={s.adText}>{t('home:advertisement')}</Text>
          </View>
        ) : null}

        {/* Word of the Hour — between the ad slot and the level controls.
            Rotates hourly via the srsApi.todaysWord timer in this screen.
            Collapses up out of view (height → 0 + fade + slide) as the movie
            feed is scrolled, and springs back at the top of the feed.
            Currently hidden — see SHOW_WORD_OF_THE_HOUR at the top of the file. */}
        {SHOW_WORD_OF_THE_HOUR ? (
          <Animated.View
            style={{
              overflow: 'hidden',
              height: wordCollapse.interpolate({
                inputRange: [0, 1],
                outputRange: [WORD_BLOCK_H, 0],
              }),
              opacity: wordCollapse.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [1, 0, 0],
              }),
            }}
          >
            <Animated.View
              style={{
                transform: [
                  {
                    translateY: wordCollapse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -48],
                    }),
                  },
                ],
              }}
            >
              {todaysWord ? (
                // key by the word so the hourly rotation remounts the card. Its
                // translation/flip state is seeded from the `word` prop on mount
                // only; without a fresh mount the front face shows the new word
                // while the back face keeps the previous hour's translation.
                <TodayWordCard
                  key={todaysWord.word}
                  word={todaysWord}
                  targetLanguage={targetLanguage}
                />
              ) : (
                <TodayWordCardSkeleton />
              )}
            </Animated.View>
          </Animated.View>
        ) : null}

      </View>

      {/* Ranked feed — the sole full-height scroller. It owns pull-to-refresh
          and keyboard-dismiss now that the outer ScrollView is gone, and its
          scroll offset drives the Word-of-the-Hour collapse above. The cards
          themselves are untouched; the container just trims side padding. */}
      <View style={s.feedSection}>
        {(homeTab === 'level' ? levelLoading : loading) ? (
          <FeedSkeleton />
        ) : homeTab === 'level' ? (
          <RankedMovieList
            movies={levelMovies}
            onMoviePress={handleMoviePress}
            onEndReached={loadMoreLevel}
            loadingMore={levelLoadingMore}
            hasMore={levelHasMore}
            onScrollOffset={handleFeedScroll}
            onSwipeAction={handleSwipeAction}
            bottomInset={bottomOffset + 12}
            fillHeight
            onScrollBeginDrag={() => { Keyboard.dismiss(); setSearchFocused(false); }}
            emptyMessage={
              movieType === 'all'
                ? undefined
                : t('home:rankedList.emptyFiltered', {
                    type: t(
                      MOVIE_TYPE_OPTIONS.find((o) => o.value === movieType)!.labelKey,
                    ),
                  })
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={tc.gold}
                colors={[tc.gold]}
              />
            }
          />
        ) : (
          <SnapPager
            movies={trendingMovies}
            onMoviePress={handleMoviePress}
          />
        )}
      </View>

      {/* Both sheets render here, at the screen root, rather than inside the
          controls that open them: BottomSheet is an absolute overlay, so from
          inside the 46pt header row or the search block it would be clipped to
          that row instead of covering the screen. */}
      <LevelSheet
        visible={openSheet === 'level'}
        onClose={() => setOpenSheet('none')}
        bottomOffset={bottomOffset}
        level={selectedLevel}
        onLevelChange={setSelectedLevel}
      />
      <FeedFilterSheet
        visible={openSheet === 'filters'}
        onClose={() => setOpenSheet('none')}
        bottomOffset={bottomOffset}
        sort={levelSort}
        sortAsc={levelSortAsc}
        onSortPress={handleSortPress}
        movieType={movieType}
        onMovieTypeChange={setMovieType}
        onReset={() => {
          setLevelSort(DEFAULT_FEED_FILTERS.sort);
          setLevelSortAsc(DEFAULT_FEED_FILTERS.sortAsc);
          setMovieType(DEFAULT_FEED_FILTERS.movieType);
        }}
      />
    </SafeAreaView>
  );
};

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: tc.background,
    },
    glow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 240,
    },
    headerStack: {
      // Pinned above the feed. The raised zIndex lets the search autocomplete
      // dropdown (which overflows this block) paint over the movie list below.
      zIndex: 10,
    },
    searchLayer: {
      // Above the ad slot + controls so the autocomplete dropdown overlays them.
      zIndex: 300,
      position: 'relative',
    },
    adSlot: {
      marginHorizontal: 18,
      marginBottom: 14,
      height: 58,
      borderRadius: 12,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: tc.border,
      backgroundColor: tc.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adText: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 2,
      color: tc.textFaint,
      textTransform: 'uppercase',
    },
    feedSection: {
      // Takes the rest of the screen below the pinned header so the movie list
      // is the page's sole, full-height scroller.
      flex: 1,
      // Narrower side padding than the old `styles.section` (16) so the
      // ranked cards render a touch wider. The card geometry itself is
      // unchanged — only this container's gutters shrink.
      paddingHorizontal: 10,
    },
  });

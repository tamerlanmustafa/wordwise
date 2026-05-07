import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ImageBackground,
  LayoutAnimation,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { colors, cefrColors, cefrLabels } from '../../theme/palette';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';
import { tmdbGenres } from '../../core/types';
import {
  wordwiseApi,
  adminApi,
  API_BASE_URL,
  type VocabularyResponse,
  type WordInfo,
} from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { offlineCache } from '../../services/offlineCache';
import { AccordionSwitch } from '../ui/AccordionSwitch';
import { CEFRTab } from '../vocabulary/CEFRTab';
import { WordRow } from '../vocabulary/WordRow';
import { IdiomRow } from '../vocabulary/IdiomRow';
import { BookmarkRowWrapper } from '../vocabulary/BookmarkRowWrapper';
import { LinearGradient } from 'expo-linear-gradient';
import { MoviePhotosModal } from '../MoviePhotosModal';

const LEARNED_ROW_ANIM = {
  duration: 260,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};

interface Props {
  movie: MovieData;
  onBack: () => void;
  targetLanguage: string;
  // Receives the *resolved internal movieId* (not the TMDB id); the screen
  // waits until vocabulary loads before enabling. The pre-movie quiz
  // handler returns a Promise so we can render a spinner on the button
  // while the backend warms up translations (~1–3s).
  // Global bottom-bar handlers.
}

export const MovieDetailScreen = ({
  movie,
  onBack,
  targetLanguage,
}: Props) => {
  const targetLang = targetLanguage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>('B1');
  const [viewMode, setViewMode] = useState<'levels' | 'idioms'>('levels');
  const [activeExprLevel, setActiveExprLevel] = useState<'elementary' | 'intermediate' | 'advanced'>('intermediate');
  const [wordSortOrder, setWordSortOrder] = useState<'rare' | 'common'>('rare');
  const [wordsView, setWordsView] = useState<'foryou' | 'all'>('foryou');
  const [movieId, setMovieId] = useState<number | null>(null);

  const [difficulty, setDifficulty] = useState<{ level: string; score: number } | null>(null);
  const [savedWords, setSavedWords] = useState<Set<string>>(new Set());
  const [learnedWords, setLearnedWords] = useState<Set<string>>(new Set());
  const [pendingLearned, setPendingLearned] = useState<string | null>(null);
  const pendingLearnedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAuthenticated = useAuthStore((s) => s.status) === 'authenticated' || useAuthStore((s) => s.status) === 'offline_authenticated';
  const authUser = useAuthStore((s) => s.user);
  const userProficiency = (authUser?.proficiency_level || 'B1').toUpperCase();

  const [currentBookmarkWord, setCurrentBookmarkWord] = useState<string | null>(null);
  const currentBookmarkWordRef = useRef<string | null>(null);
  useEffect(() => {
    currentBookmarkWordRef.current = currentBookmarkWord;
  }, [currentBookmarkWord]);
  const [restoreTrigger, setRestoreTrigger] = useState(0);
  const [accordionMode, setAccordionMode] = useState(true);
  const [lastOpenedKey, setLastOpenedKey] = useState<string | null>(null);
  const [posterZoomOpen, setPosterZoomOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const bookmarkAppliedRef = useRef(false);
  const pendingBookmarkRef = useRef<{ word: string | null; level: string; mode: 'levels' | 'idioms'; explicit?: boolean } | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const rowYOffsets = useRef<Record<string, number>>({});
  const listContainerY = useRef<number>(0);

  const bookmarkKey = `movie_bookmark_${movie.id}`;

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevLevelRef = useRef<string>(activeLevel);
  const prevViewModeRef = useRef<'levels' | 'idioms'>(viewMode);

  const toggleIndicator = useRef(new Animated.Value(viewMode === 'idioms' ? 1 : 0)).current;

  useEffect(() => {
    const levelChanged = prevLevelRef.current !== activeLevel;
    const modeChanged = prevViewModeRef.current !== viewMode;

    if (levelChanged || modeChanged) {
      rowYOffsets.current = {};
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
      prevLevelRef.current = activeLevel;
      prevViewModeRef.current = viewMode;
    }
  }, [activeLevel, viewMode, fadeAnim]);

  useEffect(() => {
    Animated.timing(toggleIndicator, {
      toValue: viewMode === 'idioms' ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [viewMode, toggleIndicator]);

  useEffect(() => {
    loadVocabulary();
  }, []);

  const tmdbId = movie.tmdb_id || (typeof movie.id === 'number' ? movie.id : undefined);
  const cacheKey = tmdbId ?? movie.id;

  const applyVocabulary = async (
    vocab: VocabularyResponse,
    resolvedMovieId: number,
    diff?: { level: string; score: number } | null,
  ) => {
    setMovieId(resolvedMovieId);
    setVocabulary(vocab);
    if (diff) setDifficulty(diff);

    const bookmark = await readBookmark();
    if (bookmark) {
      pendingBookmarkRef.current = bookmark;
      setCurrentBookmarkWord(bookmark.word);
      setViewMode(bookmark.mode);
      if (bookmark.mode === 'levels') {
        setActiveLevel(bookmark.level);
      } else {
        setActiveExprLevel(bookmark.level as 'elementary' | 'intermediate' | 'advanced');
      }
      setRestoreTrigger((n) => n + 1);
    } else {
      const levels = Object.entries(vocab.level_distribution);
      if (levels.length > 0) {
        const maxLevel = levels.reduce((a, b) => (a[1] > b[1] ? a : b));
        setActiveLevel(maxLevel[0]);
      }
    }
  };

  const fetchFromNetwork = async (
    opts: { silent: boolean },
  ): Promise<{ vocab: VocabularyResponse; movieId: number; difficulty: { level: string; score: number } | null } | null> => {
    const cleanTitle = movie.title.replace(/["""'']/g, '').trim();
    const scriptResult = await wordwiseApi.fetchScript('', cleanTitle, tmdbId);
    if (!scriptResult.cleaned_text || scriptResult.word_count < 100) {
      if (!opts.silent) setError('Script too short or not found');
      return null;
    }

    const genreNames = movie.genre_ids?.map((id) => tmdbGenres[id]).filter(Boolean) || [];
    await wordwiseApi.classifyVocabulary(scriptResult.movie_id, targetLang, genreNames);

    // Run /difficulty and vocabulary fetch in parallel — neither depends on
    // the other, so there's no reason to wait for difficulty before fetching
    // words. Saves one sequential round-trip (~30% faster first-time open).
    const [diffResult, vocab] = await Promise.all([
      fetch(`${API_BASE_URL}/movies/${scriptResult.movie_id}/difficulty`)
        .then(async (r) => {
          if (!r.ok) return null;
          const d = await r.json();
          return d.difficulty_score != null
            ? ({ level: d.difficulty_level, score: d.difficulty_score } as { level: string; score: number })
            : null;
        })
        .catch(() => null),
      wordwiseApi.getVocabularyFull(scriptResult.movie_id)
        .catch(() => wordwiseApi.getVocabularyPreview(scriptResult.movie_id)),
    ]);

    const diff = diffResult;

    offlineCache.savePayload(cacheKey, movie.title, {
      vocabulary: vocab,
      movieId: scriptResult.movie_id,
      difficulty: diff,
    });

    return { vocab, movieId: scriptResult.movie_id, difficulty: diff };
  };

  const loadVocabulary = async () => {
    setError(null);
    bookmarkAppliedRef.current = false;
    pendingBookmarkRef.current = null;
    rowYOffsets.current = {};

    if (isAuthenticated) {
      wordwiseApi.getSavedWords()
        .then((saved) => setSavedWords(new Set(saved.map((w) => w.word))))
        .catch(() => {});
      wordwiseApi.getLearnedWords()
        .then((learned) => setLearnedWords(new Set(learned.map((w) => w.word))))
        .catch(() => {});
    }

    const cached = await offlineCache.getPayload(cacheKey);
    if (cached?.vocabulary) {
      setLoading(false);
      await applyVocabulary(cached.vocabulary, cached.movieId, cached.difficulty || null);

      (async () => {
        try {
          const freshVocab = await wordwiseApi.getVocabularyFull(cached.movieId);
          const cachedStr = JSON.stringify({
            dist: cached.vocabulary.level_distribution,
            words: cached.vocabulary.top_words_by_level,
          });
          const freshStr = JSON.stringify({
            dist: freshVocab.level_distribution,
            words: freshVocab.top_words_by_level,
          });
          if (cachedStr !== freshStr) {
            setVocabulary(freshVocab);
            offlineCache.savePayload(cacheKey, movie.title, {
              vocabulary: freshVocab,
              movieId: cached.movieId,
              difficulty: cached.difficulty || null,
            });
          }
        } catch {}
      })();
      return;
    }

    setLoading(true);
    try {
      const fresh = await fetchFromNetwork({ silent: false });
      if (!fresh) return;
      await applyVocabulary(fresh.vocab, fresh.movieId, fresh.difficulty);

    } catch (err: any) {
      console.error('Failed to load vocabulary:', err);
      setError(err.message || 'Failed to load vocabulary');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkLearned = useCallback((word: string) => {
    if (!isAuthenticated) return;
    if (pendingLearnedTimerRef.current) {
      clearTimeout(pendingLearnedTimerRef.current);
      pendingLearnedTimerRef.current = null;
    }
    const previousPending = pendingLearned;
    if (previousPending && previousPending !== word) {
      wordwiseApi.markWordLearned(previousPending).catch(() => {});
      setLearnedWords((prev) => {
        const next = new Set(prev);
        next.add(previousPending);
        return next;
      });
    }

    LayoutAnimation.configureNext(LEARNED_ROW_ANIM);
    setLearnedWords((prev) => {
      const next = new Set(prev);
      next.add(word);
      return next;
    });
    setPendingLearned(word);

    pendingLearnedTimerRef.current = setTimeout(() => {
      pendingLearnedTimerRef.current = null;
      setPendingLearned((current) => (current === word ? null : current));
      wordwiseApi.markWordLearned(word).catch(() => {
        LayoutAnimation.configureNext(LEARNED_ROW_ANIM);
        setLearnedWords((prev) => {
          const next = new Set(prev);
          next.delete(word);
          return next;
        });
      });
    }, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, pendingLearned]);

  const handleUndoLearned = () => {
    if (!pendingLearned) return;
    if (pendingLearnedTimerRef.current) {
      clearTimeout(pendingLearnedTimerRef.current);
      pendingLearnedTimerRef.current = null;
    }
    LayoutAnimation.configureNext(LEARNED_ROW_ANIM);
    setLearnedWords((prev) => {
      const next = new Set(prev);
      next.delete(pendingLearned);
      return next;
    });
    setPendingLearned(null);
  };

  useEffect(() => {
    return () => {
      if (pendingLearnedTimerRef.current) {
        clearTimeout(pendingLearnedTimerRef.current);
        pendingLearnedTimerRef.current = null;
      }
      if (pendingLearned) {
        wordwiseApi.markWordLearned(pendingLearned).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveWord = useCallback(async (word: string) => {
    if (!isAuthenticated) return;
    try {
      const result = await wordwiseApi.saveWord(word, movieId);
      setSavedWords(prev => {
        const next = new Set(prev);
        if (result.saved) {
          next.add(word);
        } else {
          next.delete(word);
        }
        return next;
      });
      wordwiseApi.logInteraction(word, result.saved ? 'WORD_SAVE' : 'WORD_UNSAVE', movieId);
    } catch {}
  }, [isAuthenticated, movieId]);

  // Admin-only: globally hide this word. Prompts for confirmation, calls
  // /admin/hidden-words, and drops the word from the local vocabulary so the
  // row disappears without needing a full refetch.
  const handleHideWord = useCallback((word: string) => {
    Alert.alert(
      'Hide word globally?',
      `"${word}" will be removed from every movie and book vocabulary list for all users. You can undo this from the admin panel.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: async () => {
            try {
              await adminApi.hideWord(word, 'Misspelled / bad data');
              setVocabulary((prev) => {
                if (!prev) return prev;
                const nextByLevel: typeof prev.top_words_by_level = {};
                for (const [lvl, list] of Object.entries(prev.top_words_by_level)) {
                  nextByLevel[lvl] = list.filter((w: WordInfo) => w.word !== word);
                }
                return { ...prev, top_words_by_level: nextByLevel };
              });
            } catch (e: any) {
              Alert.alert('Failed to hide word', e?.message || 'Unknown error');
            }
          },
        },
      ]
    );
  // No deps that change — adminApi is stable, setVocabulary is stable.
  }, []);

  type Bookmark = {
    word: string | null;
    level: string;
    mode: 'levels' | 'idioms';
    explicit: boolean;
  };

  async function readBookmark(): Promise<Bookmark | null> {
    try {
      const raw = await AsyncStorage.getItem(bookmarkKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const recordBookmark = useCallback((word: string) => {
    if (currentBookmarkWordRef.current === word) {
      setCurrentBookmarkWord(null);
      AsyncStorage.removeItem(bookmarkKey).catch(() => {});
      return;
    }
    const bm: Bookmark = {
      word,
      level: viewMode === 'levels' ? activeLevel : activeExprLevel,
      mode: viewMode,
      explicit: true,
    };
    setCurrentBookmarkWord(word);
    AsyncStorage.setItem(bookmarkKey, JSON.stringify(bm)).catch(() => {});
  }, [bookmarkKey, viewMode, activeLevel, activeExprLevel]);

  useEffect(() => {
    if (!vocabulary || !pendingBookmarkRef.current || bookmarkAppliedRef.current) return;
    const bm = pendingBookmarkRef.current;
    let attempts = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const tryScroll = () => {
      const rowY = bm.word ? rowYOffsets.current[bm.word] : undefined;
      if (rowY != null && scrollViewRef.current) {
        const target = Math.max(0, listContainerY.current + rowY - 120);
        const scrollAnim = new Animated.Value(0);
        const id = scrollAnim.addListener(({ value }) => {
          scrollViewRef.current?.scrollTo({ y: value, animated: false });
        });
        Animated.timing(scrollAnim, {
          toValue: target,
          duration: 1100,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: false,
        }).start(() => {
          scrollAnim.removeListener(id);
        });
        bookmarkAppliedRef.current = true;
        pendingBookmarkRef.current = null;
        return;
      }
      if (++attempts < 20) {
        timers.push(setTimeout(tryScroll, 150));
      } else {
        bookmarkAppliedRef.current = true;
        pendingBookmarkRef.current = null;
      }
    };
    timers.push(setTimeout(tryScroll, 400));
    return () => { timers.forEach(clearTimeout); };
  }, [vocabulary, activeLevel, activeExprLevel, viewMode, restoreTrigger]);

  const wordLevels = useMemo(() => {
    if (!vocabulary) return [];

    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    return levels.map((level) => ({
      level,
      label: cefrLabels[level] || level,
      count: vocabulary.level_distribution[level as keyof typeof vocabulary.level_distribution] || 0,
      words: vocabulary.top_words_by_level[level] || [],
    }));
  }, [vocabulary]);

  const idioms = vocabulary?.idioms || [];
  const hasIdioms = idioms.length > 0;

  const EXPR_LEVEL_MAP: Record<string, 'elementary' | 'intermediate' | 'advanced'> = {
    A1: 'elementary', A2: 'elementary',
    B1: 'intermediate', B2: 'intermediate',
    C1: 'advanced', C2: 'advanced',
  };
  const idiomsByDifficulty = useMemo(() => {
    const groups: Record<string, any[]> = { elementary: [], intermediate: [], advanced: [] };
    idioms.forEach((idiom) => {
      const lvl = (idiom.cefr_level || 'C1').toUpperCase();
      const bucket = EXPR_LEVEL_MAP[lvl] || 'advanced';
      groups[bucket].push(idiom);
    });
    return groups;
  }, [idioms]);

  useEffect(() => {
    if (viewMode === 'idioms' && !hasIdioms) {
      setViewMode('levels');
    }
  }, [viewMode, hasIdioms]);

  const isIdiomsTab = viewMode === 'idioms';
  const activeData = wordLevels.find((l) => l.level === activeLevel);
  const allActiveWords = activeData?.words || [];
  const allActiveIdioms = isIdiomsTab ? (idiomsByDifficulty[activeExprLevel] || []) : [];
  const filteredActiveWords = learnedWords.size
    ? allActiveWords.filter((w: any) => !learnedWords.has(w.word))
    : allActiveWords;
  const activeWords = useMemo(() => {
    const arr = [...filteredActiveWords];
    arr.sort((a: any, b: any) => {
      const aNull = a.frequency_rank == null;
      const bNull = b.frequency_rank == null;
      if (aNull && !bNull) return 1;
      if (!aNull && bNull) return -1;
      if (aNull && bNull) return 0;
      return wordSortOrder === 'rare'
        ? b.frequency_rank - a.frequency_rank
        : a.frequency_rank - b.frequency_rank;
    });
    return arr;
  }, [filteredActiveWords, wordSortOrder]);
  const activeIdioms = learnedWords.size
    ? allActiveIdioms.filter((i: any) => !learnedWords.has(i.phrase || i.word))
    : allActiveIdioms;

  const SUGGESTED_CAP = 60;
  const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const suggestedWords = useMemo<Array<WordInfo & { cefr_level: string }>>(() => {
    if (!vocabulary) return [];
    const idx = LEVEL_ORDER.indexOf(userProficiency);
    if (idx < 0) return [];
    const targetLevels = [userProficiency];
    if (idx + 1 < LEVEL_ORDER.length) targetLevels.push(LEVEL_ORDER[idx + 1]);

    const pool: Array<WordInfo & { cefr_level: string }> = [];
    for (const lvl of targetLevels) {
      const list = vocabulary.top_words_by_level[lvl] || [];
      for (const w of list) {
        if (learnedWords.has(w.word)) continue;
        pool.push({ ...w, cefr_level: lvl });
      }
    }
    pool.sort((a, b) => {
      const aNull = a.frequency_rank == null;
      const bNull = b.frequency_rank == null;
      if (aNull && !bNull) return 1;
      if (!aNull && bNull) return -1;
      if (aNull && bNull) return 0;
      return (b.frequency_rank as number) - (a.frequency_rank as number);
    });
    return pool;
  }, [vocabulary, userProficiency, learnedWords]);

  const suggestedVisible = suggestedWords.slice(0, SUGGESTED_CAP);
  const suggestedHidden = Math.max(0, suggestedWords.length - SUGGESTED_CAP);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.detailHeaderTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.movieInfoBar}>
        {movie.backdrop_path && (
          <ImageBackground
            source={{ uri: `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` }}
            style={styles.movieHeaderBackdropFill}
            imageStyle={styles.movieHeaderBackdropImg}
            resizeMode="cover"
          />
        )}
        <View style={styles.movieHeaderOverlay} />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.72)']}
          style={styles.movieHeaderOverlayBottom}
        />
        <View style={styles.movieHeaderRow}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => setPosterZoomOpen(true)}>
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w185${movie.poster_path}` }}
              style={styles.detailPoster}
            />
          </TouchableOpacity>
          <View style={styles.movieInfoText}>
            <Text style={styles.movieInfoTitle} numberOfLines={2}>{movie.title}</Text>
            <View style={styles.movieMetaRow}>
              <Text style={styles.movieInfoYear}>{movie.release_date?.slice(0, 4)}</Text>
              {movie.vote_average != null && (
                <Text style={styles.movieRating}>★ {movie.vote_average.toFixed(1)}</Text>
              )}
              {movie.original_language && (
                <Text style={styles.movieLanguage}>{movie.original_language.toUpperCase()}</Text>
              )}
            </View>
            {movie.genre_ids && movie.genre_ids.length > 0 && (
              <View style={styles.genreRow}>
                {movie.genre_ids.slice(0, 3).map((id) => (
                  <View key={id} style={styles.genreChip}>
                    <Text style={styles.genreChipText}>{tmdbGenres[id] || 'Other'}</Text>
                  </View>
                ))}
              </View>
            )}
            {difficulty && (
              <View style={[styles.difficultyChip, { backgroundColor: cefrColors[difficulty.level] || colors.primary }]}>
                <Text style={styles.difficultyChipText}>
                  {difficulty.level} · {difficulty.score}%
                </Text>
              </View>
            )}
            {authUser?.is_admin && (
              <TouchableOpacity
                onPress={() => setPhotosOpen(true)}
                style={styles.photosBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.photosBtnText}>🖼 Photos</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
      <View style={{ flex: 1 }}>
      {loading ? (
        <>
          {movie.overview ? (
            <View style={styles.overviewSection}>
              <Text style={styles.overviewText} numberOfLines={2}>{movie.overview}</Text>
            </View>
          ) : null}
          <View style={[styles.container, styles.centered]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Analyzing vocabulary...</Text>
            <Text style={styles.loadingSubtext}>Searching script</Text>
            <Text style={styles.loadingSubtext}>Classifying words by CEFR level</Text>
          </View>
        </>
      ) : error ? (
        <>
          {movie.overview ? (
            <View style={styles.overviewSection}>
              <Text style={styles.overviewText} numberOfLines={2}>{movie.overview}</Text>
            </View>
          ) : null}
          <View style={styles.scriptErrorBox}>
            <Text style={styles.scriptErrorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadVocabulary}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : vocabulary ? (
        <ScrollView
          ref={scrollViewRef}
          stickyHeaderIndices={[1]}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <View>
            {movie.overview ? (
              <View style={styles.overviewSection}>
                <Text style={styles.overviewText} numberOfLines={2}>{movie.overview}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.stickyVocabHeader}>
            {hasIdioms && (
              <View style={styles.viewModeToggleWrapper}>
                <Animated.View
                  style={[
                    styles.viewModeToggleIndicator,
                    {
                      transform: [
                        {
                          translateX: toggleIndicator.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 130],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.viewModeToggleBtn}
                  onPress={() => setViewMode('levels')}
                >
                  <Text style={[styles.viewModeToggleText, viewMode === 'levels' && styles.viewModeToggleTextActive]}>
                    Words
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.viewModeToggleBtn}
                  onPress={() => setViewMode('idioms')}
                >
                  <Text style={[styles.viewModeToggleText, viewMode === 'idioms' && styles.viewModeToggleTextActive]}>
                    Expressions ({idioms.length})
                  </Text>
                </TouchableOpacity>
              </View>
            )}


            {/* Inline view filter — For You / All Levels. Only shown on
                the words tab (not idioms). Replaces the old bottom-bar
                position since nav is now global. */}
            {!isIdiomsTab && (
              <View style={styles.wordsViewSegmented}>
                <TouchableOpacity
                  style={[styles.wordsViewSegment, wordsView === 'foryou' && styles.wordsViewSegmentActive]}
                  onPress={() => startTransition(() => setWordsView('foryou'))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.wordsViewSegmentText, wordsView === 'foryou' && styles.wordsViewSegmentTextActive]}>
                    For You
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.wordsViewSegment, wordsView === 'all' && styles.wordsViewSegmentActive]}
                  onPress={() => startTransition(() => setWordsView('all'))}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.wordsViewSegmentText, wordsView === 'all' && styles.wordsViewSegmentTextActive]}>
                    All Levels
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isIdiomsTab ? (
              <>
                <View style={styles.exprTabsRow}>
                  {([
                    { key: 'elementary' as const, label: 'Elementary', color: '#4CAF50' },
                    { key: 'intermediate' as const, label: 'Intermediate', color: '#FFC107' },
                    { key: 'advanced' as const, label: 'Advanced', color: '#F44336' },
                  ]).map((tab) => (
                    <TouchableOpacity
                      key={tab.key}
                      style={[
                        styles.exprTab,
                        activeExprLevel === tab.key && { backgroundColor: tab.color + '18', borderColor: tab.color },
                      ]}
                      onPress={() => setActiveExprLevel(tab.key)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.exprTabText,
                        activeExprLevel === tab.key && { color: tab.color, fontWeight: '700' },
                      ]}>
                        {tab.label} ({idiomsByDifficulty[tab.key]?.length || 0})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : wordsView === 'foryou' ? (
              <>
                {suggestedWords.length === 0 ? (
                  <Text style={styles.forYouEmpty}>No new words at your level</Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.cefrTabsWrapper}>
                  <View style={styles.cefrTabsGradientBorder}>
                    <View style={styles.cefrTabsInner}>
                      <View style={styles.cefrTabsContent}>
                        {wordLevels.map((levelData) => (
                          <CEFRTab
                            key={levelData.level}
                            level={levelData.level}
                            label={levelData.label}
                            count={levelData.count}
                            active={activeLevel === levelData.level}
                            color={cefrColors[levelData.level] || colors.primary}
                            onPress={() => setActiveLevel(levelData.level)}
                          />
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
                <Text style={styles.cefrLevelCount}>
                  <Text style={{ color: cefrColors[activeLevel] || colors.primary, fontWeight: '700' }}>
                    {activeData?.count ?? 0}
                  </Text>{' '}
                  {activeLevel} words
                </Text>
                <View style={styles.wordSortRow}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setWordSortOrder('rare')}
                    style={[
                      styles.wordSortPill,
                      wordSortOrder === 'rare' && {
                        backgroundColor: cefrColors[activeLevel] || colors.primary,
                        borderColor: cefrColors[activeLevel] || colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.wordSortPillText,
                        wordSortOrder === 'rare' && styles.wordSortPillTextActive,
                      ]}
                    >
                      Least common {activeLevel}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => setWordSortOrder('common')}
                    style={[
                      styles.wordSortPill,
                      wordSortOrder === 'common' && {
                        backgroundColor: cefrColors[activeLevel] || colors.primary,
                        borderColor: cefrColors[activeLevel] || colors.primary,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.wordSortPillText,
                        wordSortOrder === 'common' && styles.wordSortPillTextActive,
                      ]}
                    >
                      Most common {activeLevel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <View style={styles.accordionToggleRow}>
              <Text style={styles.accordionToggleText}>
                Close previous row when opening a new one
              </Text>
              <AccordionSwitch value={accordionMode} onToggle={() => setAccordionMode((v) => !v)} />
            </View>
          </View>

          <Animated.View
            style={{ opacity: fadeAnim }}
            onLayout={(e) => { listContainerY.current = e.nativeEvent.layout.y; }}
          >
            <View style={styles.wordList}>
              {isIdiomsTab ? (
                activeIdioms.map((item, index) => {
                  const key = item.phrase;
                  return (
                    <BookmarkRowWrapper
                      key={`idiom-${key}`}
                      wordKey={key}
                      onLayoutY={(w, y) => { rowYOffsets.current[w] = y; }}
                      onBookmark={recordBookmark}
                      onMarkLearned={isAuthenticated ? handleMarkLearned : undefined}
                      isCurrentBookmark={currentBookmarkWord === key}
                    >
                      <IdiomRow
                        idiom={item}
                        index={index}
                        rowNumber={index + 1}
                        groupColor={cefrColors[activeLevel] || colors.primary}
                        movieId={movieId}
                        targetLang={targetLang}
                        isSaved={savedWords.has(key)}
                        onSave={handleSaveWord}
                        isAuthenticated={isAuthenticated}
                        bookmarkHighlight={currentBookmarkWord === key}
                        accordionMode={accordionMode}
                        lastOpenedKey={lastOpenedKey}
                        onExpand={setLastOpenedKey}
                      />
                    </BookmarkRowWrapper>
                  );
                })
              ) : wordsView === 'foryou' ? (
                <>
                  {suggestedVisible.map((item, index) => {
                    const key = item.word;
                    return (
                      <BookmarkRowWrapper
                        key={key}
                        wordKey={key}
                        onLayoutY={(w, y) => { rowYOffsets.current[w] = y; }}
                        onBookmark={recordBookmark}
                        onMarkLearned={isAuthenticated ? handleMarkLearned : undefined}
                        isCurrentBookmark={currentBookmarkWord === key}
                      >
                        <WordRow
                          word={item}
                          index={index}
                          rowNumber={index + 1}
                          groupColor={cefrColors[item.cefr_level] || colors.primary}
                          movieId={movieId}
                          movieTitle={movie.title}
                          targetLang={targetLang}
                          isSaved={savedWords.has(key)}
                          onSave={handleSaveWord}
                          isAuthenticated={isAuthenticated}
                          bookmarkHighlight={currentBookmarkWord === key}
                          accordionMode={accordionMode}
                          lastOpenedKey={lastOpenedKey}
                          onExpand={setLastOpenedKey}
                          displayLevel={item.cefr_level}
                          onHide={authUser?.is_admin ? handleHideWord : undefined}
                        />
                      </BookmarkRowWrapper>
                    );
                  })}
                  {suggestedHidden > 0 && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => startTransition(() => setWordsView('all'))}
                      style={styles.foryouMoreLink}
                    >
                      <Text style={styles.foryouMoreLinkText}>
                        + {suggestedHidden} more — see all in All levels
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                activeWords.map((item, index) => {
                  const key = item.word;
                  return (
                    <BookmarkRowWrapper
                      key={key}
                      wordKey={key}
                      onLayoutY={(w, y) => { rowYOffsets.current[w] = y; }}
                      onBookmark={recordBookmark}
                      onMarkLearned={isAuthenticated ? handleMarkLearned : undefined}
                      isCurrentBookmark={currentBookmarkWord === key}
                    >
                      <WordRow
                        word={item}
                        index={index}
                        rowNumber={index + 1}
                        groupColor={cefrColors[activeLevel] || colors.primary}
                        movieId={movieId}
                        movieTitle={movie.title}
                        targetLang={targetLang}
                        isSaved={savedWords.has(key)}
                        onSave={handleSaveWord}
                        isAuthenticated={isAuthenticated}
                        bookmarkHighlight={currentBookmarkWord === key}
                        accordionMode={accordionMode}
                        lastOpenedKey={lastOpenedKey}
                        onExpand={setLastOpenedKey}
                        onHide={authUser?.is_admin ? handleHideWord : undefined}
                      />
                    </BookmarkRowWrapper>
                  );
                })
              )}
            </View>
          </Animated.View>
        </ScrollView>
      ) : null}
      <Modal
        visible={posterZoomOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPosterZoomOpen(false)}
      >
        <TouchableWithoutFeedback onPress={() => setPosterZoomOpen(false)}>
          <View style={styles.posterZoomBackdrop}>
            <TouchableWithoutFeedback>
              <View>
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w780${movie.poster_path}` }}
                  style={styles.posterZoomImage}
                  resizeMode="contain"
                />
                <TouchableOpacity
                  style={styles.posterShareBtn}
                  onPress={async () => {
                    try {
                      const remote = `https://image.tmdb.org/t/p/original${movie.poster_path}`;
                      const safeTitle = movie.title.replace(/[^\w\-]+/g, '_');
                      const localPath = `${FileSystem.cacheDirectory}${safeTitle}_poster.jpg`;
                      const { uri } = await FileSystem.downloadAsync(remote, localPath);
                      const { status } = await MediaLibrary.requestPermissionsAsync();
                      if (status === 'granted') {
                        await MediaLibrary.saveToLibraryAsync(uri);
                        Alert.alert('Saved', 'Poster saved to your Photos.');
                      } else {
                        Alert.alert('Permission denied', 'Allow photo access to save the poster.');
                      }
                    } catch (e) {
                      Alert.alert('Download failed', 'Could not save poster.');
                    }
                  }}
                >
                  <Text style={styles.posterShareBtnText}>Save to photos</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      </View>

      {pendingLearned && (
        <View style={styles.undoToast} pointerEvents="box-none">
          <View style={styles.undoToastInner}>
            <Text style={styles.undoToastText} numberOfLines={1}>
              "{pendingLearned}" hidden
            </Text>
            <TouchableOpacity onPress={handleUndoLearned} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.undoToastAction}>UNDO</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <MoviePhotosModal
        visible={photosOpen}
        tmdbId={movie.tmdb_id || (typeof movie.id === 'number' ? movie.id : null)}
        movieTitle={movie.title}
        onClose={() => setPhotosOpen(false)}
      />
    </SafeAreaView>
  );
};

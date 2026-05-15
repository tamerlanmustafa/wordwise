import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { colors, cefrColors, cefrLabels } from '../../theme/palette';
import { useThemeColors } from '../../theme/tokens';
import { LinearGradient } from 'expo-linear-gradient';
import { styles } from '../../core/styles';
import type { MovieData } from '../../core/types';
import { tmdbGenres } from '../../core/types';
import {
  wordwiseApi,
  adminApi,
  API_BASE_URL,
  type VocabularyResponse,
  type WordInfo,
  type IdiomInfo,
} from '../../services/api';

// Words and idioms render side-by-side in the same level list. Discriminate
// by checking for the idiom-only `phrase` field.
type RowItem = WordInfo | IdiomInfo;
const isIdiom = (item: RowItem): item is IdiomInfo => 'phrase' in item;
import { useAuthStore } from '../../stores/authStore';
import { offlineCache } from '../../services/offlineCache';
import { WordRow } from '../vocabulary/WordRow';
import { IdiomRow } from '../vocabulary/IdiomRow';
import { BookmarkRowWrapper } from '../vocabulary/BookmarkRowWrapper';
import { SceneStrip, type SceneStripProps } from '../vocabulary/SceneStrip';
import { ForYouWordRow } from '../vocabulary/ForYouWordRow';

const LEARNED_ROW_ANIM = {
  duration: 260,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};

// TODO: wire sceneStrips once the scenes endpoint returns
// { afterWord, sceneNumber, sceneTitle, timestamp, image_path, words_in_scene[] } per movie.
type SceneStripEntry = { afterWord: string } & SceneStripProps;

interface Props {
  movie: MovieData;
  onBack: () => void;
  targetLanguage: string;
  readWords?: Set<string>;
  sceneStrips?: SceneStripEntry[];
}

export const MovieDetailScreen = ({
  movie,
  onBack,
  targetLanguage,
  readWords,
  sceneStrips,
}: Props) => {
  const tc = useThemeColors();
  const insets = useSafeAreaInsets();
  const targetLang = targetLanguage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>('B1');
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
  useEffect(() => {
    AsyncStorage.getItem('accordion_mode').then((v) => {
      if (v === 'off') setAccordionMode(false);
    });
  }, []);
  const [lastOpenedKey, setLastOpenedKey] = useState<string | null>(null);
  const [posterZoomOpen, setPosterZoomOpen] = useState(false);
  const bookmarkAppliedRef = useRef(false);
  const pendingBookmarkRef = useRef<{ word: string | null; level: string; explicit?: boolean } | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const rowYOffsets = useRef<Record<string, number>>({});
  const listContainerY = useRef<number>(0);

  const bookmarkKey = `movie_bookmark_${movie.id}`;

  const [overviewExpanded, setOverviewExpanded] = useState(false);
  // Hide-on-scroll-down, show-on-scroll-up pattern for the back+title bar.
  // The filter tabs always stay visible; only the navigation row slides away.
  const NAV_BAR_HEIGHT = insets.top + 44;
  const navSlide = useRef(new Animated.Value(0)).current; // 0 = shown, 1 = hidden
  const lastScrollY = useRef(0);
  const navHiddenRef = useRef(false);
  const animateNav = useCallback((hidden: boolean) => {
    if (navHiddenRef.current === hidden) return;
    navHiddenRef.current = hidden;
    Animated.timing(navSlide, {
      toValue: hidden ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [navSlide]);
  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    // Near the top, always show the nav bar.
    if (y < NAV_BAR_HEIGHT) {
      animateNav(false);
    } else if (Math.abs(dy) > 6) {
      // Hide on a meaningful downward gesture, show on upward.
      if (dy > 0) animateNav(true);
      else animateNav(false);
    }
    lastScrollY.current = y;
  }, [NAV_BAR_HEIGHT, animateNav]);

  // Slide only the nav row's body (44px), not the full NAV_BAR_HEIGHT.
  // A permanent filler covers the safe-area inset area so the filter tabs
  // never slip behind the dynamic island when the nav row hides.
  const NAV_ROW_BODY = 44;
  const navTranslateY = navSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -NAV_ROW_BODY],
  });
  // tabsHeight is measured via onLayout once the filter tabs render. The
  // top-of-list spacer matches the visible area of the absolute top bar:
  // (inset filler + navBar body + tabs) when shown, (inset filler + tabs)
  // when the navBar has slid away — so tabs always sit below the island.
  const [tabsHeight, setTabsHeight] = useState(0);
  const spacerHeight = navSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [NAV_BAR_HEIGHT + tabsHeight, insets.top + tabsHeight],
  });
  const prevLevelRef = useRef<string>(activeLevel);

  useEffect(() => {
    if (prevLevelRef.current !== activeLevel) {
      rowYOffsets.current = {};
      prevLevelRef.current = activeLevel;
    }
  }, [activeLevel]);

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
      let resolvedLevel = bookmark.level;
      // Migrate legacy idioms-mode bookmarks: their level was a difficulty
      // bucket ("elementary"/"intermediate"/"advanced") rather than a CEFR
      // code, so look up the bookmarked phrase to find its real CEFR level.
      if ((bookmark as any).mode === 'idioms' && bookmark.word) {
        const found = (vocab.idioms || []).find((i) => i.phrase === bookmark.word);
        if (found?.cefr_level) resolvedLevel = found.cefr_level.toUpperCase();
      }
      const restored = { word: bookmark.word, level: resolvedLevel, explicit: !!bookmark.explicit };
      pendingBookmarkRef.current = restored;
      setCurrentBookmarkWord(bookmark.word);
      setActiveLevel(resolvedLevel);
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
      level: activeLevel,
      explicit: true,
    };
    setCurrentBookmarkWord(word);
    AsyncStorage.setItem(bookmarkKey, JSON.stringify(bm)).catch(() => {});
  }, [bookmarkKey, activeLevel]);

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
  }, [vocabulary, activeLevel, restoreTrigger]);

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

  // Idioms have their own CEFR level, so we group them the same way words are
  // grouped — by exact CEFR match. They render inline with the level's words.
  const idiomsByLevel = useMemo(() => {
    const groups: Record<string, IdiomInfo[]> = { A1: [], A2: [], B1: [], B2: [], C1: [], C2: [] };
    idioms.forEach((idiom) => {
      const lvl = (idiom.cefr_level || 'C1').toUpperCase();
      if (groups[lvl]) groups[lvl].push(idiom);
    });
    return groups;
  }, [idioms]);

  const activeData = wordLevels.find((l) => l.level === activeLevel);
  const allActiveWords = activeData?.words || [];
  const allActiveIdioms = idiomsByLevel[activeLevel] || [];
  const filteredActiveWords = learnedWords.size
    ? allActiveWords.filter((w: any) => !learnedWords.has(w.word))
    : allActiveWords;
  const filteredActiveIdioms = learnedWords.size
    ? allActiveIdioms.filter((i) => !learnedWords.has(i.phrase))
    : allActiveIdioms;
  // Words and idioms share the level's row list. Idioms have no frequency
  // rank so they always sort to the end (matching the existing null-rank
  // behavior for words).
  const activeItems = useMemo<RowItem[]>(() => {
    const arr: RowItem[] = [...filteredActiveWords, ...filteredActiveIdioms];
    arr.sort((a, b) => {
      const aRank = isIdiom(a) ? null : a.frequency_rank;
      const bRank = isIdiom(b) ? null : b.frequency_rank;
      const aNull = aRank == null;
      const bNull = bRank == null;
      if (aNull && !bNull) return 1;
      if (!aNull && bNull) return -1;
      if (aNull && bNull) return 0;
      return wordSortOrder === 'rare'
        ? (bRank as number) - (aRank as number)
        : (aRank as number) - (bRank as number);
    });
    return arr;
  }, [filteredActiveWords, filteredActiveIdioms, wordSortOrder]);

  const SUGGESTED_CAP = 60;
  const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  type SuggestedItem = (WordInfo & { cefr_level: string }) | (IdiomInfo & { cefr_level: string });
  const suggestedWords = useMemo<SuggestedItem[]>(() => {
    if (!vocabulary) return [];
    const idx = LEVEL_ORDER.indexOf(userProficiency);
    if (idx < 0) return [];
    const targetLevels = new Set([userProficiency]);
    if (idx + 1 < LEVEL_ORDER.length) targetLevels.add(LEVEL_ORDER[idx + 1]);

    const pool: SuggestedItem[] = [];
    for (const lvl of targetLevels) {
      const list = vocabulary.top_words_by_level[lvl] || [];
      for (const w of list) {
        if (learnedWords.has(w.word)) continue;
        pool.push({ ...w, cefr_level: lvl });
      }
      const idiomList = idiomsByLevel[lvl] || [];
      for (const i of idiomList) {
        if (learnedWords.has(i.phrase)) continue;
        pool.push({ ...i, cefr_level: lvl });
      }
    }
    pool.sort((a, b) => {
      const aRank = isIdiom(a) ? null : a.frequency_rank;
      const bRank = isIdiom(b) ? null : b.frequency_rank;
      const aNull = aRank == null;
      const bNull = bRank == null;
      if (aNull && !bNull) return 1;
      if (!aNull && bNull) return -1;
      if (aNull && bNull) return 0;
      return (bRank as number) - (aRank as number);
    });
    return pool;
  }, [vocabulary, userProficiency, learnedWords, idiomsByLevel]);

  const suggestedVisible = suggestedWords.slice(0, SUGGESTED_CAP);
  const suggestedHidden = Math.max(0, suggestedWords.length - SUGGESTED_CAP);

  // Sliding tab indicator for the scrollable level row. The For You tab
  // lives in a separate fixed container so it isn't part of the slide.
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const indicatorPositioned = useRef(false);

  const activeScrollKey: string | null = wordsView === 'all' ? activeLevel : null;
  const activeIndicatorColor = `${cefrColors[activeLevel] || colors.primary}20`;

  useEffect(() => {
    if (!activeScrollKey) {
      Animated.timing(indicatorOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: false,
      }).start();
      return;
    }
    const layout = tabLayouts.current[activeScrollKey];
    if (!layout) return;
    Animated.parallel([
      Animated.timing(indicatorX, {
        toValue: layout.x,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(indicatorWidth, {
        toValue: layout.width,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(indicatorOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: false,
      }),
    ]).start();
  }, [activeScrollKey, indicatorX, indicatorWidth, indicatorOpacity]);

  const handleScrollTabLayout = (key: string) => (e: { nativeEvent: { layout: { x: number; width: number } } }) => {
    const { x, width } = e.nativeEvent.layout;
    tabLayouts.current[key] = { x, width };
    if (key === activeScrollKey && !indicatorPositioned.current) {
      indicatorX.setValue(x);
      indicatorWidth.setValue(width);
      indicatorOpacity.setValue(1);
      indicatorPositioned.current = true;
    }
  };

  // Defer the heavy list inputs so tab taps update the header immediately
  // while the row re-render runs at lower priority on the next tick.
  const deferredWordsView = useDeferredValue(wordsView);
  const deferredActiveItems = useDeferredValue(activeItems);
  const deferredSuggestedVisible = useDeferredValue(suggestedVisible);

  // Treatment A: rarity fill ratio per word, computed from the visible set's rank range.
  const freqFillMap = useMemo(() => {
    const list = deferredWordsView === 'foryou' ? deferredSuggestedVisible : deferredActiveItems;
    const wordItems = list.filter((item): item is WordInfo => !isIdiom(item));
    const ranks = wordItems.map((w) => w.frequency_rank).filter((r): r is number => r != null);
    if (ranks.length < 2) return new Map<string, number>();
    const minRank = Math.min(...ranks);
    const maxRank = Math.max(...ranks);
    const range = maxRank - minRank;
    return new Map(wordItems.map((w) => [
      w.word,
      w.frequency_rank == null || range === 0 ? 0 : (w.frequency_rank - minRank) / range,
    ]));
  }, [deferredWordsView, deferredSuggestedVisible, deferredActiveItems]);

  // Treatment E: scene strip lookup by afterWord.
  const sceneStripMap = useMemo(() => {
    const map = new Map<string, SceneStripEntry>();
    (sceneStrips ?? []).forEach((s) => map.set(s.afterWord, s));
    return map;
  }, [sceneStrips]);

  // Pre-fetch sentence examples for the visible list in a single batch call.
  // Used by both the For You tab and the level tabs (A1–C2) to filter out
  // rows whose example sentence is missing or too long.
  //
  // Race condition we're handling: classify-script schedules a background
  // task that populates SentenceBank in ~2-5s. The first batch request
  // typically beats that task and gets empty results. We mark those misses
  // as 'miss-recent', bump retryTick after 5s, and the effect re-runs to
  // refetch them. A second empty response promotes them to 'miss-confirmed'
  // (the word genuinely has no indexed sentence — extract_word_sentences
  // does literal matching and skips inflected forms).
  const MAX_SENTENCE_CHARS = 75;
  type SentenceEntry = { sentence: string; word_position: number; matched_form: string };
  type FetchStatus = 'in-flight' | 'in-flight-retry' | 'hit' | 'miss-recent' | 'miss-confirmed';
  const [sentencePreviews, setSentencePreviews] = useState<Record<string, SentenceEntry>>({});
  const [sentencesRetryTick, setSentencesRetryTick] = useState(0);
  const sentencesStatusRef = useRef<Record<string, FetchStatus>>({});

  useEffect(() => {
    if (!movieId) return;
    const words = wordsView === 'foryou'
      ? suggestedWords
          .slice(0, SUGGESTED_CAP)
          .filter((w): w is WordInfo & { cefr_level: string } => !isIdiom(w))
          .map((w) => w.word)
      : activeItems
          .filter((w): w is WordInfo => !isIdiom(w))
          .map((w) => w.word);
    const status = sentencesStatusRef.current;
    const missing = words.filter((w) => {
      const s = status[w];
      return s === undefined || s === 'miss-recent';
    });
    if (!missing.length) return;
    missing.forEach((w) => {
      status[w] = status[w] === 'miss-recent' ? 'in-flight-retry' : 'in-flight';
    });
    // No cancel-on-rerun guard: the request is for `missing` words on this
    // movie, and setSentencePreviews only merges. If MovieDetailScreen has
    // unmounted (movie navigation), React no-ops the setState. If the effect
    // re-ran for the same movie (e.g. background vocab refresh changed
    // suggestedWords' identity), in-flight status prevents a duplicate fetch
    // and the original promise still updates state when it resolves.
    wordwiseApi.batchSentences(movieId, missing).then((results) => {
      let firstMisses = 0;
      setSentencePreviews((prev) => {
        const next = { ...prev };
        for (const w of missing) {
          const wasRetry = status[w] === 'in-flight-retry';
          const list = results[w] || [];
          if (list.length > 0) {
            next[w] = list[0];
            status[w] = 'hit';
          } else {
            next[w] = { sentence: '', word_position: 0, matched_form: w };
            if (wasRetry) {
              status[w] = 'miss-confirmed';
            } else {
              status[w] = 'miss-recent';
              firstMisses++;
            }
          }
        }
        return next;
      });
      if (firstMisses > 0) {
        setTimeout(() => setSentencesRetryTick((t) => t + 1), 5000);
      }
    }).catch(() => {
      // Reset so a future render can re-attempt.
      missing.forEach((w) => {
        if (status[w] === 'in-flight' || status[w] === 'in-flight-retry') {
          delete status[w];
        }
      });
    });
  }, [movieId, wordsView, suggestedWords, activeItems, sentencesRetryTick]);

  // Chunked rendering: mount the first 25 rows immediately on a tab switch,
  // then progressively reveal the rest in batches. ~100 WordRow mounts in
  // one frame is the actual bottleneck — splitting them across frames keeps
  // the tap responsive.
  const INITIAL_ROWS = 25;
  const ROW_BATCH = 35;
  const ROW_BATCH_DELAY = 40;
  const SKELETON_DURATION = 140;
  const [renderLimit, setRenderLimit] = useState(INITIAL_ROWS);
  const [isSwitching, setIsSwitching] = useState(false);
  const activeListLength = deferredWordsView === 'foryou'
    ? deferredSuggestedVisible.length
    : deferredActiveItems.length;
  // Reset whenever the user changes the active filter set.
  useEffect(() => {
    setRenderLimit(INITIAL_ROWS);
    setIsSwitching(true);
    const id = setTimeout(() => setIsSwitching(false), SKELETON_DURATION);
    return () => clearTimeout(id);
  }, [wordsView, activeLevel, wordSortOrder]);
  // Progressively grow until we've rendered everything in the active list.
  useEffect(() => {
    if (renderLimit >= activeListLength) return;
    const id = setTimeout(() => {
      setRenderLimit((n) => Math.min(n + ROW_BATCH, activeListLength));
    }, ROW_BATCH_DELAY);
    return () => clearTimeout(id);
  }, [renderLimit, activeListLength]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tc.background }]} edges={['bottom']}>
      <StatusBar barStyle="light-content" />

      {/* Permanent dynamic-island filler — always visible behind the island
          so nothing scrolls underneath it. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: tc.background,
          zIndex: 11,
        }}
      />

      {/* Sliding top bar: back+title slides away on scroll down; tabs stay
          anchored just below the dynamic island. */}
      <Animated.View
        style={{
          position: 'absolute',
          top: insets.top,
          left: 0,
          right: 0,
          zIndex: 10,
          backgroundColor: tc.background,
          transform: [{ translateY: navTranslateY }],
        }}
      >
        <View style={[styles.detailHeader, { paddingTop: 8, backgroundColor: tc.background, borderBottomWidth: 0 }]}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle} numberOfLines={1}>
            {movie.title}
          </Text>
          <View style={{ width: 60 }} />
        </View>
        {vocabulary ? (
          <View
            onLayout={(e) => setTabsHeight(e.nativeEvent.layout.height)}
            style={[styles.stickyVocabHeader, { backgroundColor: tc.background }]}
          >
            <View style={styles.unifiedTabsRowWrapper}>
            <View style={styles.unifiedTabsLeftFixed}>
              {(() => {
                const foryouActive = wordsView === 'foryou';
                return (
                  <TouchableOpacity
                    style={[
                      styles.unifiedTab,
                      foryouActive && { backgroundColor: `${colors.primary}20` },
                    ]}
                    onPress={() => {
                      startTransition(() => setWordsView('foryou'));
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.unifiedTabLabel,
                      foryouActive && [styles.unifiedTabLabelActive, { color: colors.primary }],
                    ]}>
                      ★ For You
                    </Text>
                  </TouchableOpacity>
                );
              })()}
              <View style={styles.unifiedTabDivider} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.unifiedTabsRow, { paddingLeft: 120 }]}
            >
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.unifiedTabIndicator,
                  {
                    left: indicatorX,
                    width: indicatorWidth,
                    opacity: indicatorOpacity,
                    backgroundColor: activeIndicatorColor,
                  },
                ]}
              />
              {wordLevels.map((lvl) => {
                const active = wordsView === 'all' && activeLevel === lvl.level;
                const c = cefrColors[lvl.level] || colors.primary;
                return (
                  <TouchableOpacity
                    key={lvl.level}
                    style={[styles.unifiedTab, styles.unifiedTabLevel]}
                    onLayout={handleScrollTabLayout(lvl.level)}
                    onPress={() => {
                      startTransition(() => setWordsView('all'));
                      setActiveLevel(lvl.level);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.unifiedTabLabel,
                      active && [styles.unifiedTabLabelActive, { color: c }],
                    ]}>
                      {lvl.level}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <LinearGradient
              colors={['rgba(228,220,240,0)', '#E4DCF0']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.unifiedTabsRightFade}
              pointerEvents="none"
            />
            </View>
            {wordsView === 'foryou' ? (
              suggestedWords.length === 0 ? (
                <Text style={styles.forYouEmpty}>No new words at your level</Text>
              ) : null
            ) : (
              <TouchableOpacity
                style={styles.countSortRow}
                onPress={() => setWordSortOrder((o) => (o === 'rare' ? 'common' : 'rare'))}
                activeOpacity={0.6}
              >
                <Text style={styles.countSortText}>
                  <Text style={{ color: cefrColors[activeLevel] || colors.primary, fontWeight: '700' }}>
                    {(activeData?.count ?? 0) + (allActiveIdioms.length || 0)}
                  </Text>
                  {' '}{activeLevel} {allActiveIdioms.length > 0 ? 'items' : 'words'} · {wordSortOrder === 'rare' ? 'Least common' : 'Most common'} ↓
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </Animated.View>

      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          scrollEventThrottle={16}
          onScroll={handleScroll}
        >
          {/* Spacer matches the visible area of the absolute top bar */}
          <Animated.View style={{ height: spacerHeight }} />
          {/* Hero — scrolls away naturally */}
          <View>
            <View style={[styles.heroBackdrop, { height: 240 + insets.top }]}>
            {movie.backdrop_path ? (
              <Image
                source={{ uri: `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` }}
                style={styles.heroBackdropImage}
                resizeMode="cover"
              />
            ) : null}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0.55)', 'transparent']}
              style={[styles.heroTopFade, { height: 80 + insets.top }]}
            />
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
              locations={[0, 0.3, 0.7, 1]}
              style={styles.heroBottomGradient}
            />
            <View style={[styles.heroBackButtonOverlay, { top: insets.top + 4 }]}>
              <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.heroBackButtonText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.heroFloating}>
              <Pressable onPress={() => setPosterZoomOpen(true)} style={styles.heroPoster}>
                <Image
                  source={{ uri: `https://image.tmdb.org/t/p/w185${movie.poster_path}` }}
                  style={styles.heroPosterImage}
                  resizeMode="cover"
                />
              </Pressable>
              <View style={styles.heroMetaCol}>
                <Text style={styles.heroTitle} numberOfLines={2}>{movie.title}</Text>
                <Text style={styles.heroMetaRow} numberOfLines={1}>
                  {movie.release_date ? (
                    <Text style={styles.heroMetaYear}>{movie.release_date.slice(0, 4)}</Text>
                  ) : null}
                  {movie.release_date && movie.vote_average != null ? (
                    <Text style={styles.heroMetaSep}>{'  ·  '}</Text>
                  ) : null}
                  {movie.vote_average != null ? (
                    <Text style={styles.heroMetaRating}>★ {movie.vote_average.toFixed(1)}</Text>
                  ) : null}
                  {(movie.release_date || movie.vote_average != null) && movie.genre_ids && movie.genre_ids.length > 0 ? (
                    <Text style={styles.heroMetaSep}>{'  ·  '}</Text>
                  ) : null}
                  {movie.genre_ids && movie.genre_ids.length > 0 ? (
                    <Text style={styles.heroMetaGenres}>
                      {movie.genre_ids.slice(0, 3).map((id) => tmdbGenres[id]).filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </Text>
                {difficulty && (
                  <View style={[styles.heroDifficultyChip, { backgroundColor: cefrColors[difficulty.level] || colors.primary }]}>
                    <Text style={styles.heroDifficultyChipText}>
                      {difficulty.level} · {difficulty.score}% match
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          {movie.overview ? (
            <View style={styles.overviewBox}>
              <Text
                style={styles.overviewText}
                numberOfLines={overviewExpanded ? undefined : 2}
              >
                {movie.overview}
              </Text>
              <Pressable onPress={() => setOverviewExpanded((v) => !v)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.overviewToggle}>
                  {overviewExpanded ? 'Show less' : 'Read more'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          </View>

          {/* Child 1: sticky vocab tabs, or loading / error shown below the hero */}
          {loading ? (
            <View style={[styles.container, styles.centered]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>Analyzing vocabulary...</Text>
              <Text style={styles.loadingSubtext}>Searching script</Text>
              <Text style={styles.loadingSubtext}>Classifying words by CEFR level</Text>
            </View>
          ) : error ? (
            <View style={styles.scriptErrorBox}>
              <Text style={styles.scriptErrorText}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadVocabulary}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Child 2: word list */}
          {vocabulary ? (
          <View
            onLayout={(e) => { listContainerY.current = e.nativeEvent.layout.y; }}
          >
            <View style={[styles.wordList, { backgroundColor: tc.background }]}>
              {isSwitching ? (
                Array.from({ length: INITIAL_ROWS }).map((_, i) => (
                  <View key={`skel-${i}`} style={styles.wordSkeletonRow}>
                    <View style={[styles.wordSkeletonBar, styles.wordSkeletonBarPrimary]} />
                    <View style={[styles.wordSkeletonBar, styles.wordSkeletonBarSecondary]} />
                  </View>
                ))
              ) : deferredWordsView === 'foryou' ? (
                <>
                  {deferredSuggestedVisible
                    .slice(0, renderLimit)
                    .filter((item) => {
                      if (isIdiom(item)) return true;
                      const entry = sentencePreviews[item.word];
                      if (!entry) return true; // still loading → keep skeleton
                      if (!entry.sentence) return false; // confirmed miss → hide
                      if (entry.sentence.length > MAX_SENTENCE_CHARS) return false;
                      return true;
                    })
                    .map((item, index) => {
                    if (isIdiom(item)) {
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
                            groupColor={cefrColors[item.cefr_level] || colors.primary}
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
                    }
                    const key = item.word;
                    return (
                      <React.Fragment key={key}>
                        <BookmarkRowWrapper
                          wordKey={key}
                          onLayoutY={(w, y) => { rowYOffsets.current[w] = y; }}
                          onBookmark={recordBookmark}
                          onMarkLearned={isAuthenticated ? handleMarkLearned : undefined}
                          isCurrentBookmark={currentBookmarkWord === key}
                        >
                          <ForYouWordRow
                            word={item}
                            rowNumber={index + 1}
                            level={item.cefr_level}
                            movieId={movieId}
                            targetLang={targetLang}
                            isSaved={savedWords.has(key)}
                            onSave={handleSaveWord}
                            isAuthenticated={isAuthenticated}
                            bookmarkHighlight={currentBookmarkWord === key}
                            isRead={readWords?.has(key)}
                            accordionMode={accordionMode}
                            lastOpenedKey={lastOpenedKey}
                            onExpand={setLastOpenedKey}
                            preloadedSentence={sentencePreviews[key]}
                          />
                        </BookmarkRowWrapper>
                        {sceneStripMap.has(key) && <SceneStrip {...sceneStripMap.get(key)!} />}
                      </React.Fragment>
                    );
                  })}
                  {suggestedHidden > 0 && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => startTransition(() => setWordsView('all'))}
                      style={styles.foryouMoreLink}
                    >
                      <Text style={styles.foryouMoreLinkText}>
                        + {suggestedHidden} more words across all levels
                      </Text>
                      <Text style={styles.foryouMoreLinkArrow}>→</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                deferredActiveItems
                  .slice(0, renderLimit)
                  .filter((item) => {
                    if (isIdiom(item)) return true;
                    const entry = sentencePreviews[item.word];
                    if (!entry) return true; // still loading → keep skeleton
                    if (!entry.sentence) return false; // confirmed miss → hide
                    if (entry.sentence.length > MAX_SENTENCE_CHARS) return false;
                    return true;
                  })
                  .map((item, index) => {
                  if (isIdiom(item)) {
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
                  }
                  const key = item.word;
                  return (
                    <React.Fragment key={key}>
                      <BookmarkRowWrapper
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
                          freqFill={freqFillMap.get(key)}
                          isRead={readWords?.has(key)}
                          onHide={authUser?.is_admin ? handleHideWord : undefined}
                        />
                      </BookmarkRowWrapper>
                      {sceneStripMap.has(key) && <SceneStrip {...sceneStripMap.get(key)!} />}
                    </React.Fragment>
                  );
                })
              )}
            </View>
          </View>
          ) : null}
        </ScrollView>
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

    </SafeAreaView>
  );
};

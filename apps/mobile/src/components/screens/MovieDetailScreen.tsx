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
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import { colors, cefrColors, cefrLabels } from '../../theme/palette';
import { useThemeColors, useColorScheme } from '../../theme/tokens';
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
import { stickySpacerRange } from './stickyHeaderSpacer';
import { WordRow } from '../vocabulary/WordRow';
import { IdiomRow } from '../vocabulary/IdiomRow';
import { BookmarkRowWrapper } from '../vocabulary/BookmarkRowWrapper';
import { SceneStrip, type SceneStripProps } from '../vocabulary/SceneStrip';
import { ForYouWordRow } from '../vocabulary/ForYouWordRow';
import { WordCardDeck } from '../vocabulary/WordCardDeck';
import {
  parseViewMode,
  DEFAULT_VIEW_MODE,
  VIEW_MODE_KEY,
  type VocabViewMode,
} from '../vocabulary/deckLogic';
import { track } from '../../services/analytics';
import { MONO_FAMILY } from '../../theme/fonts';

// The card-deck view (mockup 2a) is the shipping design. The rows list below
// is kept intact but DISABLED so we can come back to it: flip this to true to
// restore the rows/cards segmented toggle with rows as the persisted default.
const ROWS_MODE_ENABLED: boolean = false;

// Hide the hero poster/backdrop + overview for now; show only title + vocab stats.
const SHOW_HERO_SECTION: boolean = false;
// Hide the floating "Quiz me" pill.
const SHOW_QUIZ_PILL: boolean = false;

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
  /** Start a 5-card journey quiz drawn from this movie's vocab. The
   *  caller (App.tsx) owns the session-start round-trip and the
   *  post-quiz nav; we just surface a sticky CTA. */
  onStartQuiz?: (level: string) => void;
}

export const MovieDetailScreen = ({
  movie,
  onBack,
  targetLanguage,
  readWords,
  sceneStrips,
  onStartQuiz,
}: Props) => {
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const targetLang = targetLanguage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vocabulary, setVocabulary] = useState<VocabularyResponse | null>(null);
  const [activeLevel, setActiveLevel] = useState<string>('B1');
  const [wordSortOrder, setWordSortOrder] = useState<'rare' | 'common'>('rare');
  const [wordsView, setWordsView] = useState<'foryou' | 'all'>('foryou');
  const [movieId, setMovieId] = useState<number | null>(null);

  // Card-deck view mode (mockup 2a). While ROWS_MODE_ENABLED is false the
  // screen is locked to 'cards'; the persisted toggle only runs when the rows
  // list is re-enabled.
  const [viewMode, setViewMode] = useState<VocabViewMode>(
    ROWS_MODE_ENABLED ? DEFAULT_VIEW_MODE : 'cards',
  );
  const [deckStartWord, setDeckStartWord] = useState<string | null>(null);
  const [deckCardNumber, setDeckCardNumber] = useState(0);
  useEffect(() => {
    if (!ROWS_MODE_ENABLED) return;
    AsyncStorage.getItem(VIEW_MODE_KEY)
      .then((v) => {
        if (v != null) setViewMode(parseViewMode(v));
      })
      .catch(() => {});
  }, []);

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
  // Detect whether the overview actually spills past 2 lines so we can hide the
  // More/Less toggle when it doesn't. Measured unclamped on first layout, then
  // clamped — see the overview block below.
  const [overviewLineCount, setOverviewLineCount] = useState<number | null>(null);
  const overviewTruncated = overviewLineCount != null && overviewLineCount > 2;
  const prevLevelRef = useRef<string>(activeLevel);

  // Scroll-driven headroom for the sticky tabs header: 0 at rest (tabs sit
  // flush under the overview), growing to insets.top just as the header pins
  // so it clears the status bar / dynamic island. See stickySpacerRange.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [stickyHeaderY, setStickyHeaderY] = useState(0);
  const spacerRange = stickySpacerRange(insets.top, stickyHeaderY);
  const stickySpacerHeight = spacerRange
    ? scrollY.interpolate({ ...spacerRange, extrapolate: 'clamp' })
    : 0;

  // The floating back button fades out over the same scroll range: once the
  // tabs bar docks it would sit on top of the ★ For You tab (both live at
  // the screen's left edge), so it yields — scrolling back up restores it.
  const backBtnOpacity = spacerRange
    ? scrollY.interpolate({ ...spacerRange, outputRange: [1, 0], extrapolate: 'clamp' })
    : 1;
  const [headerDocked, setHeaderDocked] = useState(false);

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
      setDeckStartWord(bookmark.word);
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
    // Scroll-to-bookmark is a rows-mode behavior; the deck restores its own
    // cursor from the same bookmark (initialWord).
    if (viewMode !== 'rows') return;
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
  }, [vocabulary, activeLevel, restoreTrigger, viewMode]);

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

  // Hero stats-strip corpus size: total classified vocab across levels + idioms.
  const totalWordCount = vocabulary
    ? Object.values(vocabulary.level_distribution).reduce((a, b) => a + (b || 0), 0)
    : 0;
  const idiomCount = idioms.length;

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
  // The fixed section's measured width becomes the scroll row's left
  // padding, so the A1 tab starts exactly where the fixed section ends.
  const [tabsLeftWidth, setTabsLeftWidth] = useState(120);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorWidth = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const indicatorPositioned = useRef(false);

  const activeScrollKey: string | null = wordsView === 'all' ? activeLevel : null;
  const activeIndicatorColor = `${cefrColors[activeLevel] || colors.primary}20`;
  // Tabs pill surface — replaces the light-only #E4DCF0. Solid tokens (not
  // alpha tints) so the fixed ★ For You section occludes the level tabs
  // scrolling beneath it, and so the right-edge fade can hex-suffix `00`.
  const tabsPillBg = scheme === 'dark' ? tc.paper : tc.chipBg;

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
    // Snap the indicator whenever the active tab's layout lands or shifts
    // (e.g. the measured left-section width replaces the initial guess).
    // Tab-change animations aren't affected: they don't relayout the tabs.
    if (key === activeScrollKey) {
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

  // Chunked so fast-path words paint progressively. A single big batch blocks
  // on the slowest word in it — if one of 60 words misses the cache and the
  // backend takes ~3-5s to LLM-generate it, the other 59 sentences sit behind
  // it. Splitting into smaller parallel batches lets chunks without slow-path
  // misses return in ~200ms while the slow chunks finish on their own clock.
  const SENTENCE_BATCH_CHUNK = 12;
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

    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += SENTENCE_BATCH_CHUNK) {
      chunks.push(missing.slice(i, i + SENTENCE_BATCH_CHUNK));
    }

    // Schedule the 5s retry-tick at most once per effect run, even if several
    // chunks come back with first-pass misses.
    let retryTickScheduled = false;

    // No cancel-on-rerun guard: each chunk request is for its own `chunk` words
    // on this movie, and setSentencePreviews only merges. If MovieDetailScreen
    // has unmounted (movie navigation), React no-ops the setState. If the
    // effect re-ran for the same movie (e.g. background vocab refresh changed
    // suggestedWords' identity), in-flight status prevents a duplicate fetch
    // and the original promise still updates state when it resolves.
    chunks.forEach((chunk) => {
      wordwiseApi.batchSentences(movieId, chunk).then((results) => {
        let firstMisses = 0;
        setSentencePreviews((prev) => {
          const next = { ...prev };
          for (const w of chunk) {
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
        if (firstMisses > 0 && !retryTickScheduled) {
          retryTickScheduled = true;
          setTimeout(() => setSentencesRetryTick((t) => t + 1), 5000);
        }
      }).catch(() => {
        // Reset so a future render can re-attempt.
        chunk.forEach((w) => {
          if (status[w] === 'in-flight' || status[w] === 'in-flight-retry') {
            delete status[w];
          }
        });
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

  // ── Card-deck view mode (mockup 2a) ──────────────────────────────────────
  // The deck is fed the SAME list the rows render: the active tab's items
  // after the level filter, sort, learned removal, and the sentence-preview
  // availability filter the rows apply inline.
  const deckItems = useMemo(() => {
    const source: RowItem[] =
      deferredWordsView === 'foryou' ? deferredSuggestedVisible : deferredActiveItems;
    return source.filter((item) => {
      if (isIdiom(item)) return true;
      const entry = sentencePreviews[item.word];
      if (!entry) return true; // still loading → keep
      if (!entry.sentence) return false; // confirmed miss → hide
      if (entry.sentence.length > MAX_SENTENCE_CHARS) return false;
      return true;
    });
  }, [deferredWordsView, deferredSuggestedVisible, deferredActiveItems, sentencePreviews]);
  const deckTotal = deckItems.length;
  const deckCardClamped = deckTotal ? Math.min(Math.max(deckCardNumber, 1), deckTotal) : 0;

  const levelColorFor = useCallback(
    (level: string) => cefrColors[level] || colors.primary,
    [],
  );

  // Every deck advance moves the resume cursor — the same movie_bookmark_{id}
  // the rows use, written implicitly (explicit: false) so the explicit
  // "Leave off here" toggle semantics stay untouched.
  const recordAdvanceBookmark = useCallback((word: string) => {
    AsyncStorage.setItem(
      bookmarkKey,
      JSON.stringify({ word, level: activeLevel, explicit: false }),
    ).catch(() => {});
  }, [bookmarkKey, activeLevel]);

  const handleDeckCursorChange = useCallback((n: number) => setDeckCardNumber(n), []);

  // While a card is being dragged the outer ScrollView must not pan
  // vertically, or the slide and the scroll fight over the same finger.
  // Imperative on purpose: a setState here commits a re-render between the
  // deck's fly-out animation and its card remount, which strands the next
  // card off-screen (the native Animated values race the commit).
  const handleDeckDragStateChange = useCallback((dragging: boolean) => {
    scrollViewRef.current?.setNativeProps({ scrollEnabled: !dragging });
  }, []);

  const handleViewModeChange = (mode: VocabViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
    track('vocab_view_toggle', { mode });
  };

  return (
    // Plain View, no bottom safe-area edge: the GlobalBottomBar rendered
    // below this screen already pads for the home indicator, so a bottom
    // inset here would double up as dead space above the bar.
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      {/* With the hero hidden there is no dark backdrop behind the status
          bar, so the icon style has to follow the theme instead. */}
      <StatusBar
        barStyle={SHOW_HERO_SECTION || scheme === 'dark' ? 'light-content' : 'dark-content'}
      />

      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          scrollEventThrottle={16}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            scrollY.setValue(y);
            // Docked = tabs bar pinned to the top; disables the (fully
            // faded) back button so it can't steal taps from the tabs.
            setHeaderDocked(stickyHeaderY > 0 && y >= stickyHeaderY);
          }}
          stickyHeaderIndices={[1]}
        >
          {/* 0: Hero — backdrop, poster, overview. Hidden when SHOW_HERO_SECTION
              is false (cards-focused design). The onLayout is always called to
              set the sticky header position, but the visual content conditionally
              renders. */}
          <View onLayout={(e) => setStickyHeaderY(e.nativeEvent.layout.height)}>
            {SHOW_HERO_SECTION ? (
              <>
                <View style={[styles.heroBackdrop, { height: 216 + insets.top }]}>
                  {movie.backdrop_path ? (
                    <Image
                      source={{ uri: `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` }}
                      style={styles.heroBackdropImage}
                      resizeMode="cover"
                    />
                  ) : null}
                  <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(0,0,0,0.5)', 'transparent']}
                    style={[styles.heroTopFade, { height: 80 + insets.top }]}
                  />
                  <LinearGradient
                    pointerEvents="none"
                    colors={['rgba(8,6,12,0)', 'rgba(8,6,12,0.45)', 'rgba(8,6,12,0.90)']}
                    locations={[0.34, 0.64, 1]}
                    style={styles.heroBottomGradient}
                  />
                  {/* Title block — sits right of the poster tail, above the backdrop base */}
                  <View style={styles.heroTitleBlock}>
                    <Text style={styles.heroTitle} numberOfLines={2}>{movie.title}</Text>
                    <Text style={styles.heroMetaLine} numberOfLines={1}>
                      {movie.release_date ? movie.release_date.slice(0, 4) : null}
                      {movie.release_date && movie.vote_average != null ? (
                        <Text style={styles.heroMetaSep}>{'   ·   '}</Text>
                      ) : null}
                      {movie.vote_average != null ? (
                        <Text>
                          <Text style={styles.heroMetaStar}>★</Text>
                          <Text style={styles.heroMetaRating}> {movie.vote_average.toFixed(1)}</Text>
                        </Text>
                      ) : null}
                      {(movie.release_date || movie.vote_average != null) && movie.genre_ids && movie.genre_ids.length > 0 ? (
                        <Text style={styles.heroMetaSep}>{'   ·   '}</Text>
                      ) : null}
                      {movie.genre_ids && movie.genre_ids.length > 0
                        ? movie.genre_ids.slice(0, 3).map((id) => tmdbGenres[id]).filter(Boolean).join(' · ')
                        : null}
                    </Text>
                  </View>
                </View>

                {/* Bridge — the poster tail hangs 38pt below the backdrop; the stats
                    strip (CEFR match chip + corpus size) fills the space beside it. */}
                <View style={styles.bridgeRow}>
                  <Pressable onPress={() => setPosterZoomOpen(true)} style={styles.bridgePoster}>
                    <Image
                      source={{ uri: `https://image.tmdb.org/t/p/w185${movie.poster_path}` }}
                      style={styles.bridgePosterImage}
                      resizeMode="cover"
                    />
                  </Pressable>
                  <View style={styles.statsStrip}>
                    {difficulty ? (
                      <View
                        style={[
                          styles.cefrChip,
                          {
                            backgroundColor: `${cefrColors[difficulty.level] || colors.primary}${scheme === 'dark' ? '26' : '1C'}`,
                            borderColor: `${cefrColors[difficulty.level] || colors.primary}${scheme === 'dark' ? '55' : '40'}`,
                          },
                        ]}
                      >
                        <View style={[styles.cefrChipDot, { backgroundColor: cefrColors[difficulty.level] || colors.primary }]} />
                        <Text style={[styles.cefrChipText, { color: tc.text }]}>
                          {difficulty.level} · {difficulty.score}% match
                        </Text>
                      </View>
                    ) : null}
                    {totalWordCount > 0 ? (
                      <Text style={[styles.corpusText, { color: tc.textSecondary }]} numberOfLines={1}>
                        {totalWordCount} words{idiomCount > 0 ? ` · ${idiomCount} idioms` : ''}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Overview — quiet text on the app background, no box */}
                {movie.overview ? (
                  <Pressable
                    onPress={() => setOverviewExpanded((v) => !v)}
                    style={styles.overviewBlock}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <Text
                      style={[styles.overviewText, { color: tc.textSecondary }]}
                      numberOfLines={overviewExpanded ? undefined : overviewLineCount == null ? undefined : 2}
                      onTextLayout={(e) => {
                        if (overviewLineCount == null) setOverviewLineCount(e.nativeEvent.lines.length);
                      }}
                    >
                      {movie.overview}
                    </Text>
                    {overviewTruncated ? (
                      <Text style={[styles.overviewToggle, { color: tc.primaryOnSurface }]}>
                        {overviewExpanded ? 'Less ▴' : 'More ▾'}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}
              </>
            ) : (
              /* Compact header (hero hidden): safe-area padding so nothing
                 renders under the dynamic island / status bar, plus the movie
                 title centered clear of the floating back button. Because this
                 gives the hero slot real height, stickySpacerRange keeps the
                 tabs clear of the island when they pin, exactly as with the
                 full hero. */
              <View style={[deckHeaderStyles.compactHeader, { paddingTop: insets.top + 8 }]}>
                <Text
                  style={[deckHeaderStyles.compactHeaderTitle, { color: tc.text }]}
                  numberOfLines={1}
                >
                  {movie.title}
                </Text>
              </View>
            )}
          </View>

          {/* 1: Sticky tabs — sit below the hero, stick to the top of the
              viewport once scrolled past. The animated spacer expands to
              insets.top only as the header pins, so the tabs clear the
              dynamic island when stuck without leaving a gap under the
              overview at rest. The floating back button fades out on the
              same range so it never overlaps the ★ For You tab when the
              bar is docked. */}
          <View style={{ backgroundColor: tc.background }}>
            <Animated.View style={{ height: stickySpacerHeight }} />
            {vocabulary ? (
              <View style={[styles.stickyVocabHeader, { backgroundColor: tc.background }]}>
                <View style={[styles.unifiedTabsRowWrapper, { backgroundColor: tabsPillBg }]}>
                  <View
                    style={[styles.unifiedTabsLeftFixed, { backgroundColor: tabsPillBg }]}
                    onLayout={(e) => setTabsLeftWidth(Math.round(e.nativeEvent.layout.width))}
                  >
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
                            { color: tc.textSecondary },
                            foryouActive && [styles.unifiedTabLabelActive, { color: tc.primaryOnSurface }],
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
                    contentContainerStyle={[styles.unifiedTabsRow, { paddingLeft: tabsLeftWidth }]}
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
                            { color: tc.textSecondary },
                            active && [styles.unifiedTabLabelActive, { color: c }],
                          ]}>
                            {lvl.level}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <LinearGradient
                    colors={[`${tabsPillBg}00`, tabsPillBg]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.unifiedTabsRightFade}
                    pointerEvents="none"
                  />
                </View>
                {wordsView === 'foryou' ? (
                  suggestedWords.length === 0 ? (
                    <Text style={[styles.forYouEmpty, { color: tc.textSecondary }]}>No new words at your level</Text>
                  ) : viewMode === 'cards' ? (
                    <View style={[styles.countSortRow, { backgroundColor: tc.background }]}>
                      <Text style={[deckHeaderStyles.cardCount, { color: tc.textSecondary }]}>
                        CARD {deckCardClamped} / {deckTotal}
                      </Text>
                    </View>
                  ) : null
                ) : (
                  <View style={[styles.countSortRow, { backgroundColor: tc.background }]}>
                    {viewMode === 'cards' ? (
                      <Text style={[deckHeaderStyles.cardCount, { color: tc.textSecondary }]}>
                        CARD {deckCardClamped} / {deckTotal}
                      </Text>
                    ) : (
                      <Text style={[styles.countSortText, { color: tc.textSecondary }]}>
                        <Text style={{ color: cefrColors[activeLevel] || colors.primary, fontWeight: '700' }}>
                          {(activeData?.count ?? 0) + (allActiveIdioms.length || 0)}
                        </Text>
                        {' '}{activeLevel} {allActiveIdioms.length > 0 ? 'items' : 'words'}
                      </Text>
                    )}
                    <View style={deckHeaderStyles.sortCluster}>
                      <TouchableOpacity
                        onPress={() => setWordSortOrder((o) => (o === 'rare' ? 'common' : 'rare'))}
                        activeOpacity={0.6}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.countSortSort, { color: tc.primaryOnSurface }]}>
                          {wordSortOrder === 'rare' ? 'Rarest first ⇅' : 'Common first ⇅'}
                        </Text>
                      </TouchableOpacity>
                      {ROWS_MODE_ENABLED ? (
                        <View style={[deckHeaderStyles.togglePill, { backgroundColor: tc.chipBg }]}>
                          {(['rows', 'cards'] as const).map((m) => (
                            <TouchableOpacity
                              key={m}
                              onPress={() => handleViewModeChange(m)}
                              style={[
                                deckHeaderStyles.toggleSeg,
                                viewMode === m && [
                                  deckHeaderStyles.toggleSegActive,
                                  { backgroundColor: tc.paper },
                                ],
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={m === 'rows' ? 'Rows view' : 'Cards view'}
                            >
                              <Ionicons
                                name={m === 'rows' ? 'list' : 'albums-outline'}
                                size={14}
                                color={viewMode === m ? tc.text : tc.textFaint}
                              />
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}
                {viewMode === 'cards' && deckTotal > 0 ? (
                  <View style={[deckHeaderStyles.progressTrack, { backgroundColor: tc.divider }]}>
                    <View
                      style={[
                        deckHeaderStyles.progressFill,
                        {
                          backgroundColor: tc.gold,
                          width: `${Math.round((deckCardClamped / deckTotal) * 100)}%`,
                        },
                      ]}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* 2: Body (loading / error / word list) */}
          <View>
          {loading ? (
            <View style={[styles.container, styles.centered]}>
              <ActivityIndicator size="large" color={tc.primaryOnSurface} />
              <Text style={[styles.loadingText, { color: tc.text }]}>Analyzing vocabulary...</Text>
              <Text style={[styles.loadingSubtext, { color: tc.textSecondary }]}>Searching script</Text>
              <Text style={[styles.loadingSubtext, { color: tc.textSecondary }]}>Classifying words by CEFR level</Text>
            </View>
          ) : error ? (
            <View style={[styles.scriptErrorBox, { backgroundColor: tc.paper, borderColor: tc.border }]}>
              <Text style={[styles.scriptErrorText, { color: tc.textSecondary }]}>{error}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={loadVocabulary}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {vocabulary ? (
          <View
            onLayout={(e) => { listContainerY.current = e.nativeEvent.layout.y; }}
          >
            {viewMode === 'cards' && !isSwitching ? (
              // Card-deck view (mockup 2a). Remounts per tab/sort so each list
              // starts from its own bookmark restore, exactly like the rows'
              // scroll restore. Translations stay tap-on-demand inside the deck.
              <WordCardDeck
                key={`deck-${wordsView}-${activeLevel}-${wordSortOrder}`}
                items={deckItems}
                activeLevel={activeLevel}
                levelColorFor={levelColorFor}
                movieId={movieId}
                movieTitle={movie.title}
                targetLang={targetLang}
                isAuthenticated={isAuthenticated}
                savedWords={savedWords}
                onSave={handleSaveWord}
                onMarkLearned={isAuthenticated ? handleMarkLearned : undefined}
                onAdvanceBookmark={recordAdvanceBookmark}
                initialWord={deckStartWord}
                sentencePreviews={sentencePreviews}
                onCursorChange={handleDeckCursorChange}
                onDragStateChange={handleDeckDragStateChange}
              />
            ) : (
            <View style={[styles.wordList, { backgroundColor: tc.paper }]}>
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
                      style={[styles.foryouMoreLink, { backgroundColor: tc.paper, borderColor: tc.border }]}
                    >
                      <Text style={[styles.foryouMoreLinkText, { color: tc.text }]}>
                        + {suggestedHidden} more words across all levels
                      </Text>
                      <Text style={[styles.foryouMoreLinkArrow, { color: tc.primaryOnSurface }]}>→</Text>
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
                          preloadedSentence={sentencePreviews[key]}
                        />
                      </BookmarkRowWrapper>
                      {sceneStripMap.has(key) && <SceneStrip {...sceneStripMap.get(key)!} />}
                    </React.Fragment>
                  );
                })
              )}
            </View>
            )}
          </View>
          ) : null}
          </View>
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

      <Animated.View
        style={[backBtnStyles.wrap, { top: insets.top + 8, opacity: backBtnOpacity }]}
        pointerEvents={headerDocked ? 'none' : 'auto'}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [backBtnStyles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color="#fff" />
        </Pressable>
      </Animated.View>

      {/* Sticky "Quiz me" pill — fixed at the bottom-left corner, just
          above the global bottom bar. Only shown when SHOW_QUIZ_PILL is true. */}
      {SHOW_QUIZ_PILL && !loading && vocabulary && onStartQuiz ? (
        <View style={quizPillStyles.pillWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={quizPillStyles.pill}
            onPress={() => onStartQuiz(userProficiency)}
            activeOpacity={0.85}
          >
            <Text style={quizPillStyles.pillGlyph}>⚡</Text>
            <Text style={quizPillStyles.pillText}>
              Quiz me · 5 words
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Loading illusion — while the vocabulary is being fetched/classified,
          the movie's own backdrop + poster cover the whole view (a cinematic
          splash), then lift to reveal the loaded screen. Sits above everything
          including the back button; onBack stays reachable via the chip. */}
      {loading ? (
        <View style={splashStyles.wrap} pointerEvents="auto">
          {movie.backdrop_path ? (
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w780${movie.backdrop_path}` }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              blurRadius={2}
            />
          ) : null}
          <View style={splashStyles.scrim} />
          <Pressable onPress={onBack} style={[backBtnStyles.backBtn, splashStyles.backBtn]} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>
          {movie.poster_path ? (
            <Image
              source={{ uri: `https://image.tmdb.org/t/p/w342${movie.poster_path}` }}
              style={splashStyles.poster}
              resizeMode="cover"
            />
          ) : null}
          <Text style={splashStyles.title} numberOfLines={2}>{movie.title}</Text>
          <ActivityIndicator size="small" color="#FFD166" style={splashStyles.spinner} />
          <Text style={splashStyles.caption}>Analyzing vocabulary…</Text>
        </View>
      ) : null}

    </View>
  );
};

const splashStyles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: '#0F0819',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,6,18,0.72)',
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    top: 56,
  },
  poster: {
    width: 168,
    height: 248,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  title: {
    marginTop: 18,
    maxWidth: '78%',
    textAlign: 'center',
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  spinner: { marginTop: 18 },
  caption: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '600',
  },
});

const backBtnStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    zIndex: 20,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(10,8,12,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Cards-mode header pieces: the CARD n / total mono label, the 3px gold
// progress bar under the count row, and the (currently disabled) rows/cards
// segmented toggle. Colors are applied inline from tc.*.
const deckHeaderStyles = StyleSheet.create({
  // Hero-hidden top bar. Side padding clears the floating back button
  // (left 16 + 32 wide + 8 gap); the 32pt line height matches its height
  // so the title and the chevron sit on the same axis.
  compactHeader: {
    paddingHorizontal: 56,
    paddingBottom: 10,
  },
  compactHeaderTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 32,
    textAlign: 'center',
  },
  cardCount: {
    fontFamily: MONO_FAMILY,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  sortCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  togglePill: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
  },
  toggleSeg: {
    width: 28,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleSegActive: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  progressTrack: {
    height: 3,
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },
});

const quizPillStyles = StyleSheet.create({
  pillWrap: {
    // The screen container ends at the top of the global bottom bar, so
    // bottom:16 floats the pill 16pt above the bar, pinned to the left.
    position: 'absolute',
    left: 16,
    bottom: 16,
    alignItems: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#FFD166',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pillGlyph: {
    fontSize: 14,
    color: '#3a2400',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    color: '#3a2400',
    textTransform: 'uppercase',
  },
});

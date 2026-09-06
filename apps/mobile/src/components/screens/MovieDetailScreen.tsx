import React, { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, useColorScheme } from '../../theme/tokens';
import { cefrColorFor, cefrRampFor } from '../../theme/cefrRamp';
import { styles } from '../../core/styles';
import { withTap } from '../../utils/feedback';
import { showToast } from '../../stores/toastStore';
import type { MovieData } from '../../core/types';

import {
  wordwiseApi,
  adminApi,
  type VocabularyResponse,
  type WordInfo,
  type IdiomInfo,
} from '../../services/api';

// Words and idioms render side-by-side in the same level list. Discriminate
// by checking for the idiom-only `phrase` field.
type RowItem = WordInfo | IdiomInfo;
const isIdiom = (item: RowItem): item is IdiomInfo => 'phrase' in item;
import { useAuthStore } from '../../stores/authStore';
import { fetchMovieVocabulary } from '../../services/movieVocabulary';
import { offlineCache } from '../../services/offlineCache';
import { WordRow } from '../vocabulary/WordRow';
import { IdiomRow } from '../vocabulary/IdiomRow';
import { BookmarkRowWrapper } from '../vocabulary/BookmarkRowWrapper';
import { SceneStrip, type SceneStripProps } from '../vocabulary/SceneStrip';
import { ForYouWordRow } from '../vocabulary/ForYouWordRow';
import { WordCardDeck } from '../vocabulary/WordCardDeck';
import { FilmEdgeBackdrop } from '../ui/FilmEdgeBackdrop';
import { MovieDetailHero } from './MovieDetailHero';
import {
  FILTER_BAR,
  DECK_HEADER_ROW,
  PROGRESS_BAR,
  SHOW_LEVEL_FILTER_BAR,
} from '../vocabulary/deckMetrics';
import {
  parseViewMode,
  pickDefaultLevel,
  resolveBookmarkLevel,
  resumeMarker,
  DEFAULT_VIEW_MODE,
  VIEW_MODE_KEY,
  type StoredMovieBookmark,
  type VocabViewMode,
} from '../vocabulary/deckLogic';
import { hasRenderableSentence, isTopItemReady, itemKey } from '../vocabulary/sentencePreviews';
import {
  doorGeometry,
  isSplashUp,
  DOOR_OPEN_MS,
  SENTENCE_WARMUP_MAX_MS,
  SPLASH_HOLD_MS,
} from './splashGate';
import { track } from '../../services/analytics';
import { MONO_FAMILY } from '../../theme/fonts';
import { directionalIcon, FORWARD_ARROW } from '../../i18n/rtl';
import { Skeleton } from '../ui/Skeleton';
import { BoltIcon, SparkleIcon } from '../ui/icons';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';

// The card-deck view (mockup 2a) is the shipping design. The rows list below
// is kept intact but DISABLED so we can come back to it: flip this to true to
// restore the rows/cards segmented toggle with rows as the persisted default.
const ROWS_MODE_ENABLED: boolean = false;

// Hide the floating "Quiz me" pill.
const SHOW_QUIZ_PILL: boolean = false;

/**
 * How long "Knew it" stays undoable.
 *
 * One number for two things that must agree: the deferred write, and the
 * toast that offers to cancel it. Held apart they drift into a window where
 * the Undo is gone and the write has not landed — nothing to press, and still
 * time to press it.
 */
const LEARNED_COMMIT_MS = 5000;

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
  /**
   * True when this screen is being *returned* to rather than opened — coming
   * back to a film left open in the Explore tab, say.
   *
   * Skips the wordmark entirely. The splash is a first-impression device that
   * masks a cold vocabulary fetch; on a return the data is already in the
   * offline cache and paints in well under 100ms, so playing it would be a
   * second of ceremony in front of a screen that is already ready. Worse, it
   * is ceremony the user did not ask for twice — an animation earns its
   * second showing far more slowly than its first.
   */
  resumed?: boolean;
}

export const MovieDetailScreen = ({
  movie,
  onBack,
  targetLanguage,
  readWords,
  sceneStrips,
  onStartQuiz,
  resumed = false,
}: Props) => {
  // The tab bar is an absolute overlay, so the word list reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const targetLang = targetLanguage;
  const [loading, setLoading] = useState(true);
  // The other two splash holds — see splashGate.ts and the effects below. The
  // wordmark covers BOTH the vocabulary fetch and the sentence batch it starts
  // (so the first card is finished, not merely mounted, when it parts) and
  // holds for SPLASH_HOLD_MS regardless, so a cache hit doesn't flash it.
  const [sentencesWarm, setSentencesWarm] = useState(false);
  // A resume starts every hold already cleared, so the gate below is false on
  // the first render and the wordmark never mounts. Skipping it at the *state*
  // rather than hiding it in the render is what keeps the pulse loop and the
  // door animation from running at all behind a screen nobody can see.
  const [splashFloorElapsed, setSplashFloorElapsed] = useState(resumed);
  const splashHolding = isSplashUp({
    loading,
    sentencesWarm,
    floorElapsed: splashFloorElapsed,
  });
  // …and `splashMounted` outlives that by the length of the doors' slide: the
  // gate says when to START opening, not when the splash is gone.
  const [splashMounted, setSplashMounted] = useState(!resumed);
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
  const authStatus = useAuthStore((s) => s.status);
  const isAuthenticated = authStatus === 'authenticated' || authStatus === 'offline_authenticated';
  const authUser = useAuthStore((s) => s.user);
  const userProficiency = (authUser?.proficiency_level || 'B1').toUpperCase();

  const [currentBookmarkWord, setCurrentBookmarkWord] = useState<string | null>(null);
  const currentBookmarkWordRef = useRef<string | null>(null);
  useEffect(() => {
    currentBookmarkWordRef.current = currentBookmarkWord;
  }, [currentBookmarkWord]);
  const [restoreTrigger, setRestoreTrigger] = useState(0);
  // Collapsed word rows, always. The Settings toggle that wrote
  // `accordion_mode` was removed on 2026-09-05, so nothing writes that key any
  // more — reading it would have pinned anyone who had turned it off to `off`
  // for ever, with no control left to turn it back on.
  const accordionMode = true;
  const [lastOpenedKey, setLastOpenedKey] = useState<string | null>(null);
  const bookmarkAppliedRef = useRef(false);
  const pendingBookmarkRef = useRef<{ word: string | null; level: string; explicit?: boolean } | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const rowYOffsets = useRef<Record<string, number>>({});
  const listContainerY = useRef<number>(0);

  const bookmarkKey = `movie_bookmark_${movie.id}`;

  const prevLevelRef = useRef<string>(activeLevel);
  // True = the next [wordsView, activeLevel, wordSortOrder] change is not a
  // user tab switch, so the switch-skeleton must not run. Starts true to
  // cover the effect's mount run; applyVocabulary re-arms it for the
  // load-time level restore.
  const skipSwitchSkeletonRef = useRef(true);

  // Minimum splash time, counted from mount so it overlaps the real work
  // rather than adding to it: a cold open never notices this, and a cached
  // one stops flashing the wordmark for a handful of frames.
  useEffect(() => {
    if (resumed) return;
    const id = setTimeout(() => setSplashFloorElapsed(true), SPLASH_HOLD_MS);
    return () => clearTimeout(id);
    // `resumed` is fixed for the life of a mount — App remounts this screen on
    // every entry — so this is a mount-time decision, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reduce Motion swaps the doors' slide for a fade — two full-screen panels
  // travelling in opposite directions is exactly the motion the setting is for.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  // Sliding-doors reveal. One value drives both halves so they can never drift
  // apart by a frame; the doors are the last DOOR_OPEN_MS of the minimum
  // second, not an extra slice after it.
  const splashExit = useRef(new Animated.Value(0)).current;
  // Pre-armed on a resume: there are no doors to open when there was never a
  // wordmark to open them from.
  const doorsStartedRef = useRef(resumed);
  useEffect(() => {
    if (splashHolding || doorsStartedRef.current) return;
    doorsStartedRef.current = true;
    Animated.timing(splashExit, {
      toValue: 1,
      duration: reduceMotion ? DOOR_OPEN_MS / 2 : DOOR_OPEN_MS,
      // Material's accelerate curve: an exit is not watched to a stop, so it
      // leaves gently and gathers speed off-screen.
      easing: Easing.bezier(0.4, 0, 1, 1),
      useNativeDriver: true,
    // Unmount even on an interrupted run — a stranded splash is worse than a
    // clipped animation.
    }).start(() => setSplashMounted(false));
  }, [splashHolding, reduceMotion, splashExit]);

  // Splash "WW" pulse — the loading indicator: the wordmark breathes (scales
  // up and down). It keeps breathing through the split rather than freezing
  // the instant the gate clears, so the two halves leave alive.
  const splashPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!splashMounted) return;
    splashPulse.setValue(0);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(splashPulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(splashPulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [splashMounted, splashPulse]);
  // One interpolation per door. Both read the same `splashPulse`, so the two
  // halves of the wordmark breathe identically — but an animated node is
  // attached to a single view, so they cannot be the same node.
  const splashScaleFor = () =>
    splashPulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.1] });

  // Door geometry — see splashGate.doorGeometry. Each door renders the SAME
  // full-screen face and clips it to its own half, so the two halves of the
  // wordmark line up because there is only one layout, and the "WW" comes
  // apart cleanly because the seam falls between the two letters.
  const { width: screenW } = useWindowDimensions();
  const doors = doorGeometry(screenW);
  const doorExit = (to: number) =>
    splashExit.interpolate({ inputRange: [0, 1], outputRange: [0, to] });
  const doorFade = () => splashExit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const doorMotion = (travel: number) =>
    reduceMotion ? { opacity: doorFade() } : { transform: [{ translateX: doorExit(travel) }] };

  /** The splash's full-screen face, drawn once per door behind its clip. */
  const renderSplashFace = (scale: Animated.AnimatedInterpolation<number>) => (
    <>
      <Pressable
        onPress={withTap(onBack)}
        style={[
          backBtnStyles.backBtn,
          splashStyles.backBtn,
          { backgroundColor: tc.chipBg, borderColor: tc.border },
        ]}
        hitSlop={8}
      >
        <Ionicons name={directionalIcon('chevron-back')} size={19} color={tc.textSecondary} />
      </Pressable>
      <Animated.View
        style={{ transform: [{ perspective: 600 }, { rotateX: '16deg' }, { scale }] }}
      >
        {WW_EXTRUDE_DEPTHS.map((depth) => (
          <Text
            key={depth}
            style={[
              splashStyles.mark,
              splashStyles.markLayer,
              { color: tc.goldDeep, top: depth, left: depth },
            ]}
          >
            WW
          </Text>
        ))}
        <Text style={[splashStyles.mark, { color: tc.gold }]}>WW</Text>
      </Animated.View>
    </>
  );

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
    // Read the bookmark BEFORE any setState so vocab, level, and deck start
    // word all land in one commit. Setting vocabulary first mounted the deck
    // on the default level, then remounted it (keyed on activeLevel) when the
    // bookmark level arrived a commit later — a visible pop at splash lift.
    const bookmark = await readBookmark();
    const nextLevel = bookmark
      ? resolveBookmarkLevel(bookmark, vocab.idioms || [])
      : pickDefaultLevel(vocab.level_distribution);

    // A load-time level restore is not a user tab switch — don't let the
    // switch-skeleton flash rows-style bars right as the splash lifts.
    if (nextLevel && nextLevel !== prevLevelRef.current) {
      skipSwitchSkeletonRef.current = true;
    }

    setMovieId(resolvedMovieId);
    setVocabulary(vocab);
    if (diff) setDifficulty(diff);

    if (bookmark && nextLevel) {
      pendingBookmarkRef.current = { word: bookmark.word, level: nextLevel, explicit: !!bookmark.explicit };
      setCurrentBookmarkWord(bookmark.word);
      setDeckStartWord(bookmark.word);
      setRestoreTrigger((n) => n + 1);
    }
    if (nextLevel) setActiveLevel(nextLevel);
  };

  const fetchFromNetwork = async (
    opts: { silent: boolean },
  ): Promise<{ vocab: VocabularyResponse; movieId: number; difficulty: { level: string; score: number } | null } | null> => {
    const cleanTitle = movie.title.replace(/["""'']/g, '').trim();
    const genreNames = movie.genre_ids?.map((id) => t(`genre.${id}`, { defaultValue: '' })).filter(Boolean) || [];

    const result = await fetchMovieVocabulary({
      title: cleanTitle,
      tmdbId,
      targetLang,
      genreNames,
    });

    if (result.status === 'script_too_short') {
      if (!opts.silent) setError(t('movies:detail.scriptTooShort'));
      return null;
    }

    offlineCache.savePayload(cacheKey, movie.title, {
      vocabulary: result.vocab,
      movieId: result.movieId,
      difficulty: result.difficulty,
    });

    return { vocab: result.vocab, movieId: result.movieId, difficulty: result.difficulty };
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
      // Apply BEFORE dropping the splash: clearing `loading` first unmounted
      // the splash while vocabulary was still null, flashing a blank screen
      // until the bookmark read finished.
      await applyVocabulary(cached.vocabulary, cached.movieId, cached.difficulty || null);
      setLoading(false);

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

    // The same shape the film feed uses for "Seen it" and "Not interested":
    // the global toast, carrying its own Undo. This screen used to grow a
    // bespoke bar pinned above the tab bar — its own view, its own styles, its
    // own dismissal — which meant the app told you what it had just done in
    // two different places depending on which screen you were standing on.
    //
    // Its duration is the commit window, not the default 3.6s. Those two being
    // different is a gap where the Undo has gone but the write has not
    // happened yet: nothing on screen to press, and still time to press it.
    showToast({
      message: t('vocabulary:deck.markedKnown', { word }),
      tone: 'success',
      duration: LEARNED_COMMIT_MS,
      actionLabel: t('movies:detail.undo'),
      onAction: () => undoLearnedRef.current(),
    });

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
    }, LEARNED_COMMIT_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, pendingLearned]);

  // The toast is raised inside `handleMarkLearned`, which is declared above
  // the handler it needs. A ref rather than a reorder: the alternative is
  // moving a hundred lines of unrelated code to satisfy a declaration order,
  // and the ref is read at press time when the handler certainly exists.
  const undoLearnedRef = useRef<() => void>(() => {});
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
  undoLearnedRef.current = handleUndoLearned;

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
      t('movies:detail.hideWordTitle'),
      t('movies:detail.hideWordBody', { word }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('movies:detail.hide'),
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
              Alert.alert(t('movies:detail.hideWordFailed'), e?.message || t('movies:detail.hideWordUnknownError'));
            }
          },
        },
      ]
    );
  // adminApi and setVocabulary are stable; `t` changes when the app language does.
  }, [t]);

  async function readBookmark(): Promise<StoredMovieBookmark | null> {
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
    const bm: StoredMovieBookmark = {
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
      label: t(`cefr.${level}`, { defaultValue: level }),
      count: vocabulary.level_distribution[level as keyof typeof vocabulary.level_distribution] || 0,
      words: vocabulary.top_words_by_level[level] || [],
    }));
  }, [vocabulary, t]);

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
  // Used by the For You tab, the level tabs (A1–C2), and the card deck; the
  // rows additionally hide entries whose example sentence is missing.
  //
  // Race condition we're handling: classify-script schedules a background
  // task that populates SentenceBank in ~2-5s. The first batch request
  // typically beats that task and gets empty results. We mark those misses
  // as 'miss-recent', bump retryTick after 5s, and the effect re-runs to
  // refetch them. A second empty response promotes them to 'miss-confirmed'
  // (the word genuinely has no indexed sentence — extract_word_sentences
  // does literal matching and skips inflected forms).
  // Mirrors the batch endpoint's per-word payload. `definition` and `pos` have
  // to be declared even though nothing in this file reads them: the deck
  // renders them, and they only survive the trip because this object is
  // assigned through rather than constructed, so TypeScript never checks it.
  // Leaving them off the type would let any future normalisation here drop
  // every gloss on the deck with the typecheck and the whole suite still green.
  type SentenceEntry = {
    sentence: string;
    word_position: number;
    matched_form: string;
    definition?: string | null;
    pos?: string | null;
  };
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
  // Reset whenever the user changes the active filter set. The skeleton is
  // skipped for non-user changes (mount, load-time level restore) — those
  // fire while/just as the loading splash lifts, and the 140ms rows-skeleton
  // flash right before the deck mounts read as a glitch.
  useEffect(() => {
    setRenderLimit(INITIAL_ROWS);
    if (skipSwitchSkeletonRef.current) {
      skipSwitchSkeletonRef.current = false;
      return;
    }
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

  // ── Card-deck view mode (Ledger Reveal, mockup 1a) ───────────────────────
  // The deck is fed the active tab's items after the level filter, sort, and
  // learned removal, then the same renderable-sentence filter the rows apply:
  // long content steps down a type tier rather than being dropped, but a word
  // with no AI-authored example has an empty sentence slot and no card worth
  // showing. Unlike the rows (~100 mounts, hence the deferred inputs) the deck
  // renders a couple of cards, so it reads the urgent values — with the
  // deferred ones, the frame that lifts the loading splash showed an empty
  // deck until the low-priority render caught up.
  const deckItems = useMemo<RowItem[]>(
    () =>
      (wordsView === 'foryou' ? suggestedVisible : activeItems).filter((item) =>
        hasRenderableSentence(itemKey(item), sentencePreviews),
      ),
    // suggestedVisible is an unmemoized slice; depend on its memoized source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wordsView, suggestedWords, activeItems, sentencePreviews],
  );
  const deckTotal = deckItems.length;
  const deckCardClamped = deckTotal ? Math.min(Math.max(deckCardNumber, 1), deckTotal) : 0;

  // Where the reader came back to, marked on the progress rule. `deckStartWord`
  // is written once at load and never moves — the bookmark itself follows every
  // advance, so marking *that* would just redraw the fill's own edge.
  const resumeMark = useMemo(
    () => resumeMarker(deckItems.map(itemKey), deckStartWord),
    [deckItems, deckStartWord],
  );

  // ── Splash hold: the first card must be READY, not merely mounted ────────
  // Vocabulary is what *starts* the sentence batch — the batch effect can't
  // run until there are words to ask about — so dropping the splash the moment
  // vocabulary landed put that round trip on screen as a skeleton in the
  // card's sentence slot. The splash is meant to be the window where this work
  // happens, so it now waits for it: the body still mounts behind the wordmark
  // (that is what gets the deck measured and the batch fired), and only the
  // wordmark itself stays up.
  //
  // The gate is the FIRST card the deck will actually show — not the whole
  // list. Chunks are 12 wide, so that one card's request brings the next
  // eleven with it, and a confirmed miss drops its word from deckItems, which
  // moves this key along to the card that really will be on top.
  const firstCardReady = isTopItemReady(deckItems, sentencePreviews);
  useEffect(() => {
    // Latched: once the splash has lifted, a later level switch or a resolving
    // retry must never put it back up.
    if (loading || sentencesWarm) return;
    if (firstCardReady) {
      setSentencesWarm(true);
      return;
    }
    // Deadline. A word that misses SentenceBank falls through to the LLM slow
    // path, which can take seconds; nobody waits behind the wordmark for a
    // card they may swipe straight past. The skeleton is the fallback, not
    // the default.
    const id = setTimeout(() => setSentencesWarm(true), SENTENCE_WARMUP_MAX_MS);
    return () => clearTimeout(id);
  }, [loading, firstCardReady, sentencesWarm]);

  // Explainer-band inputs. Mix label = the user's level ±1, matching how the

  // The band's colour, from the ramp for the *active* theme — the same call
  // the vocabulary sheet's bar makes. The static `cefrColors` map is one
  // projection of that ramp (the dark one), so reading it here would have left
  // the deck's chip and its sentence highlight on dark-theme colours while the
  // sheet two taps away showed the light ones.
  const ramp = useMemo(() => cefrRampFor(tc), [tc]);
  const levelColorFor = useCallback(
    (level: string) => cefrColorFor(level, ramp),
    [ramp],
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

  // Nothing scrolls in cards mode any more, so the deck's drag has no
  // ScrollView to fight over the finger and needs no lock.

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
      {/* The backdrop is only a wash over the screen's own background now, so
          there is no dark slab behind the status bar and the icon style
          follows the theme rather than the artwork. */}
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />

      {/* Film-edge decoration: warm top glow + sprocket-dot strips. */}
      <FilmEdgeBackdrop topOffset={insets.top + 52} />

      {/* One fixed viewport: the column below never scrolls, so the movie's
          identity stays put and the deck's controls stay in the thumb zone.
          MovieDetailHero is a direct child because its backdrop wash is a
          SIBLING of its content — a 232pt bleed that Android would clip if it
          were nested. */}
      <View style={{ flex: 1 }}>
        <MovieDetailHero
          backdropPath={movie.backdrop_path}
          title={movie.title}
          level={difficulty?.level ?? null}
          matchPct={difficulty ? difficulty.score : null}
          onBack={onBack}
          style={{ paddingTop: insets.top }}
        />

        {/* Level filter, deck counter and progress. Nothing sticks any more
            — there is no scroll for it to stick against. */}
        {vocabulary ? (
          <View>
            {/* Ledger filter bar: For You, a divider, then the six CEFR
                chips sharing the remaining width equally — no horizontal
                scroll, selection tinted per CEFR colour.
                Hidden (SHOW_LEVEL_FILTER_BAR): the screen is For You only, so
                the whole bar goes rather than leaving one chip that cannot be
                deselected. `wordsView` therefore never leaves 'foryou' — the
                'all' branches below stay for when the bar comes back. */}
            {SHOW_LEVEL_FILTER_BAR ? (
              <View style={[ledgerStyles.filterBar, { backgroundColor: tc.chipBg }]}>
                {(() => {
                  const foryouActive = wordsView === 'foryou';
                  return (
                    <TouchableOpacity
                      style={[
                        ledgerStyles.forYouChip,
                        foryouActive && {
                          backgroundColor: `${tc.gold}29`,
                          borderColor: `${tc.gold}73`,
                        },
                      ]}
                      onPress={withTap(() => {
                        startTransition(() => setWordsView('foryou'));
                      })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: foryouActive }}
                    >
                      <SparkleIcon size={13} color={tc.gold} style={ledgerStyles.forYouGlyph} />
                      <Text
                        style={[
                          ledgerStyles.forYouLabel,
                          {
                            color: foryouActive
                              ? scheme === 'dark'
                                ? tc.goldOnSurface
                                : '#6B4A00'
                              : tc.textFaint,
                          },
                        ]}
                      >
                        {t('movies:detail.forYou')}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}
                <View style={[ledgerStyles.filterDivider, { backgroundColor: tc.border }]} />
                {wordLevels.map((lvl) => {
                  const active = wordsView === 'all' && activeLevel === lvl.level;
                  // Both from the active theme's ramp, so the chip and the
                  // sheet behind the ring agree. `cefrColorsDark` used to be
                  // consulted for the light scheme; it is now just the light
                  // projection of this same ramp, so asking the ramp directly
                  // says the same thing with one lookup instead of two.
                  const c = cefrColorFor(lvl.level, ramp);
                  const selectedColor = c;
                  return (
                    <TouchableOpacity
                      key={lvl.level}
                      style={[ledgerStyles.levelChip, active && { backgroundColor: `${c}2E` }]}
                      onPress={withTap(() => {
                        startTransition(() => setWordsView('all'));
                        setActiveLevel(lvl.level);
                      })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text
                        style={[
                          ledgerStyles.levelChipText,
                          { color: active ? selectedColor : tc.textFaint },
                          active && ledgerStyles.levelChipTextActive,
                        ]}
                      >
                        {lvl.level}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
            {/* TODO: sort control needs a new home. The rare/common pills
                lived in the explainer band; `wordSortOrder` still sorts
                the deck at its 'rare' default, there is just nothing on
                screen to change it with. */}
            {wordsView === 'foryou' && suggestedWords.length === 0 ? (
              <Text style={[styles.forYouEmpty, { color: tc.textSecondary }]}>{t('movies:detail.noNewWords')}</Text>
            ) : viewMode === 'cards' ? (
              /* Deck header row: CARD n / total, alone on its line. The deck's
                 identity tag ("FOR YOU DECK") is gone — the screen is For You
                 only, so it named the one thing it could ever say. */
              <View style={[styles.countSortRow, deckHeaderStyles.deckCountRow]}>
                <Text style={[deckHeaderStyles.cardCount, { color: tc.goldOnSurface }]}>
                  CARD {deckCardClamped} / {deckTotal}
                </Text>
              </View>
            ) : wordsView === 'all' ? (
              <View style={[styles.countSortRow, { backgroundColor: tc.background }]}>
                <Text style={[styles.countSortText, { color: tc.textSecondary }]}>
                  <Text style={{ color: levelColorFor(activeLevel), fontWeight: '700' }}>
                    {(activeData?.count ?? 0) + (allActiveIdioms.length || 0)}
                  </Text>
                  {' '}{activeLevel} {allActiveIdioms.length > 0 ? 'items' : 'words'}
                </Text>
                <View style={deckHeaderStyles.sortCluster}>
                  <TouchableOpacity
                    onPress={withTap(() => setWordSortOrder((o) => (o === 'rare' ? 'common' : 'rare')))}
                    activeOpacity={0.6}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={[styles.countSortSort, { color: tc.primaryOnSurface }]}>
                      {wordSortOrder === 'rare' ? t('movies:detail.sortRarest') : t('movies:detail.sortCommon')}
                    </Text>
                  </TouchableOpacity>
                  {ROWS_MODE_ENABLED ? (
                    <View style={[deckHeaderStyles.togglePill, { backgroundColor: tc.chipBg }]}>
                      {(['rows', 'cards'] as const).map((m) => (
                        <TouchableOpacity
                          key={m}
                          onPress={withTap(() => handleViewModeChange(m))}
                          style={[
                            deckHeaderStyles.toggleSeg,
                            viewMode === m && [
                              deckHeaderStyles.toggleSegActive,
                              { backgroundColor: tc.paper },
                            ],
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={m === 'rows' ? t('movies:detail.rowsView') : t('movies:detail.cardsView')}
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
            ) : null}
            {viewMode === 'cards' && deckTotal > 0 ? (
              <View
                style={[deckHeaderStyles.progressTrack, { backgroundColor: tc.divider }]}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: deckTotal, now: deckCardClamped }}
                // The bookmark mark is a 3pt notch and nothing else, so what it
                // says has to reach a screen reader some other way — this is
                // where the old floating chip's sentence went.
                accessibilityLabel={
                  resumeMark ? t('vocabulary:deck.resumedAt', { card: resumeMark.card }) : undefined
                }
              >
                <View
                  style={[
                    deckHeaderStyles.progressFill,
                    {
                      backgroundColor: tc.gold,
                      width: `${Math.round((deckCardClamped / deckTotal) * 100)}%`,
                    },
                  ]}
                />
                {/* Bookmark mark: a notch cut out of the rule in the screen's
                    own background, rather than a coloured tick. The rule is
                    gold where the reader has been and grey ahead of them, and
                    no one flat colour contrasts with both in both themes — a
                    gap contrasts with whatever it interrupts. It is a child of
                    the track, so the track's `overflow: hidden` clips it
                    instead of it bleeding past the rule's rounded end.

                    Placed by a percentage-width spacer rather than by a
                    percentage `start`: the fill above already proves this
                    mechanism, and `flexDirection: 'row'` mirrors itself under
                    RTL, so the mark is measured from the same end the fill
                    grows from without a second direction rule to keep in step. */}
                {resumeMark ? (
                  <View style={deckHeaderStyles.resumeMarkRow} pointerEvents="none">
                    <View style={{ width: `${resumeMark.percent}%` }} />
                    <View
                      style={[deckHeaderStyles.resumeMark, { backgroundColor: tc.background }]}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Body (error / word list). `flex: 1` all the way down to the deck:
            it is the only elastic block in the column, and it scales its
            card into whatever this leaves. While loading, the poster splash
            overlay is the loading view, so the body renders nothing. */}
        <View style={{ flex: 1 }}>
        {loading ? null : error ? (
          <View style={[styles.scriptErrorBox, { backgroundColor: tc.paper, borderColor: tc.border }]}>
            <Text style={[styles.scriptErrorText, { color: tc.textSecondary }]}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={withTap(loadVocabulary)}>
              <Text style={styles.retryButtonText}>{t('action.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {vocabulary ? (
        // `paddingBottom` is what makes the card deck's own measurement honest:
        // it lays out into whatever height this container gives it, so without
        // the bar's inset here its Know / Don't-know pills measured into the
        // strip behind the floating capsule and sat under it.
        <View
          style={{ flex: 1, paddingBottom: barInset }}
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
            />
          ) : (
          <ScrollView
            ref={scrollViewRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
          >
          <View style={[styles.wordList, { backgroundColor: tc.paper }]}>
            {isSwitching ? (
              Array.from({ length: INITIAL_ROWS }).map((_, i) => (
                // Bars were plain Views in a hard-coded `rgba(124, 92, 191, …)`
                // — the old purple primary — so they stayed lilac in dark mode
                // and never animated. The primitive carries the theme token,
                // the pulse and the reduce-motion fallback.
                <View key={`skel-${i}`} style={styles.wordSkeletonRow}>
                  <Skeleton height={12} radius={4} delay={i * 60} style={styles.wordSkeletonBarPrimary} />
                  <Skeleton width={28} height={12} radius={4} delay={i * 60 + 40} />
                </View>
              ))
            ) : deferredWordsView === 'foryou' ? (
              <>
                {deferredSuggestedVisible
                  .slice(0, renderLimit)
                  .filter((item) => hasRenderableSentence(itemKey(item), sentencePreviews))
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
                          groupColor={levelColorFor(item.cefr_level)}
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
                    onPress={withTap(() => startTransition(() => setWordsView('all')))}
                    style={[styles.foryouMoreLink, { backgroundColor: tc.paper, borderColor: tc.border }]}
                  >
                    <Text style={[styles.foryouMoreLinkText, { color: tc.text }]}>
                      + {suggestedHidden} more words across all levels
                    </Text>
                    <Text style={[styles.foryouMoreLinkArrow, { color: tc.primaryOnSurface }]}>{FORWARD_ARROW}</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              deferredActiveItems
                .slice(0, renderLimit)
                .filter((item) => hasRenderableSentence(itemKey(item), sentencePreviews))
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
                        groupColor={levelColorFor(activeLevel)}
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
                        groupColor={levelColorFor(activeLevel)}
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
          </ScrollView>
          )}
        </View>
        ) : null}
        </View>
        </View>

      {/* The back button is no longer floating: with nothing to scroll it has
          nothing to fade against, so it is a normal row inside the hero. */}

      {/* Sticky "Quiz me" pill — fixed at the bottom-left corner, just
          above the global bottom bar. Only shown when SHOW_QUIZ_PILL is true. */}
      {SHOW_QUIZ_PILL && !loading && vocabulary && onStartQuiz ? (
        <View style={quizPillStyles.pillWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={quizPillStyles.pill}
            onPress={withTap(() => onStartQuiz(userProficiency))}
            activeOpacity={0.85}
          >
            <BoltIcon size={15} color={tc.goldDeep} style={quizPillStyles.pillGlyph} />
            <Text style={quizPillStyles.pillText}>
              {t('movies:detail.quizMe', { count: 5 })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Loading splash — a pulsing extruded "WW" wordmark centered on the
          default app background. Stacked offset text layers fake the 3D
          extrusion; a perspective/rotateX tilt sells the depth.
          Two doors that part down the middle to uncover the movie screen,
          which has been mounted and laid out behind them the whole time.
          Interaction passes through the moment they start opening; onBack
          stays reachable via the chip until then.

          The background sits on the DOOR, not on the face — see the note on
          `doorFace`. Moving it down one level cuts the top half off the
          wordmark. */}
      {splashMounted ? (
        <View style={splashStyles.wrap} pointerEvents={splashHolding ? 'auto' : 'none'}>
          {[doors.left, doors.right].map((half, i) => (
            <Animated.View
              key={i}
              style={[
                splashStyles.door,
                { left: half.left, width: half.width, backgroundColor: tc.background },
                doorMotion(half.travel),
              ]}
            >
              <View style={[splashStyles.doorFace, { left: half.faceLeft, width: screenW }]}>
                {renderSplashFace(splashScaleFor())}
              </View>
            </Animated.View>
          ))}
        </View>
      ) : null}

    </View>
  );
};

// Extrusion depths (px) for the 3D "WW" splash mark, painted deepest-first
// so the face (offset 0) lands on top.
const WW_EXTRUDE_DEPTHS = [7, 6, 5, 4, 3, 2, 1];

const splashStyles = StyleSheet.create({
  // Transparent: the doors carry the background, so whatever they uncover is
  // the real screen and not another opaque layer.
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  /** Half the screen, clipping its face to that half. Carries the background
   *  colour — see `doorFace`. */
  door: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  /**
   * Full-screen face inside a door, offset so it sits where it would if the
   * splash were one undivided view. Centering lives here, not on `wrap`.
   *
   * Deliberately has NO background: the wordmark it contains is tilted with
   * `perspective` + `rotateX`, so its top half leans away from the viewer in
   * z and its bottom half leans toward them. Once the door above gained a
   * transform, that put the mark inside a 3D rendering context, and Core
   * Animation depth-sorted the receding half BEHIND any background painted on
   * this view — which read as the "WW" being sliced flat across the middle.
   * Painting the background one level up, on the door, puts a plain view
   * boundary between the ground and the 3D content, so the mark always draws
   * in front of it. Do not move it back down.
   */
  doorFace: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    position: 'absolute',
    start: 16,
    top: 56,
  },
  mark: {
    fontSize: 76,
    fontWeight: '900',
    letterSpacing: -2,
  },
  markLayer: {
    position: 'absolute',
  },
});

// The screen's back button lives in MovieDetailHero now; this is the loading
// splash's own copy, which renders before the hero exists.
const backBtnStyles = StyleSheet.create({
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Cards-mode header pieces: the CARD n / total mono label, the 3px gold
// progress bar under the count row, and the (currently disabled) rows/cards
// segmented toggle. Colors are applied inline from tc.*.
const deckHeaderStyles = StyleSheet.create({
  cardCount: {
    fontFamily: MONO_FAMILY,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.05,
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
  // The deck counter and its rule are fixed blocks in the column budget, so
  // their heights and the gaps above them come from deckMetrics rather than
  // from `countSortRow`'s generic list padding.
  deckCountRow: {
    height: DECK_HEADER_ROW.height,
    marginTop: DECK_HEADER_ROW.gap,
    paddingTop: 0,
    paddingBottom: 0,
  },
  progressTrack: {
    height: PROGRESS_BAR.height,
    marginTop: PROGRESS_BAR.gap,
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
  },
  resumeMarkRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  // `marginStart` centres the 3pt notch on the card boundary rather than
  // hanging it off the far side, and at 100% it is also what keeps a sliver of
  // it inside the track instead of clipped away entirely. `flexShrink: 0` so a
  // mark at 100% overflows into the clip rather than squeezing the spacer and
  // dragging itself backwards off its own position.
  resumeMark: {
    width: 3,
    marginStart: -1,
    flexShrink: 0,
  },
});

// Ledger filter bar + explainer band chrome (mockup 1a). Backgrounds and
// text colours are applied inline from tc.* / the CEFR maps.
const ledgerStyles = StyleSheet.create({
  // 4 + 36 chip + 4 = FILTER_BAR.height; the gaps below it belong to the
  // blocks that follow, so the column's budget lives in one place.
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: FILTER_BAR.gap,
    borderRadius: 16,
    padding: 4,
    gap: 2,
  },
  forYouChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  forYouGlyph: {
    marginTop: 0.5,
  },
  forYouLabel: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  filterDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 3,
  },
  levelChip: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  levelChipTextActive: {
    fontWeight: '800',
  },
});

const quizPillStyles = StyleSheet.create({
  pillWrap: {
    // The screen container ends at the top of the global bottom bar, so
    // bottom:16 floats the pill 16pt above the bar, pinned to the
    // leading edge.
    position: 'absolute',
    start: 16,
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
    marginTop: 0.5,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
    color: '#3a2400',
    textTransform: 'uppercase',
  },
});

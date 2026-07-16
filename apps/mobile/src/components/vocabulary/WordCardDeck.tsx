import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import type { ThemeColors } from '../../theme/tokens';
import {
  wordwiseApi,
  premiumApi,
  authFetch,
  API_BASE_URL,
  type WordInfo,
  type IdiomInfo,
} from '../../services/api';
import { useIsPremium } from '../../stores/entitlementsStore';
import { ReportDialog } from '../ReportDialog';
import { PressableScale } from '../ui/PressableScale';
import { track } from '../../services/analytics';
import { renderHighlighted, type SentenceExample } from './VocabRow';
import {
  deckReducer,
  restoreDeck,
  swipeDecision,
  promotedKeyAfterRemoval,
} from './deckLogic';

export type DeckItem = WordInfo | IdiomInfo;
const isIdiomItem = (item: DeckItem): item is IdiomInfo => 'phrase' in item;
const keyOf = (item: DeckItem) => (isIdiomItem(item) ? item.phrase : item.word);

interface CardContent {
  translation: string | null;
  enrichment: SentenceExample | null;
  loaded: boolean;
}

export interface WordCardDeckProps {
  /** Same filtered + sorted list the rows render, in display order. */
  items: DeckItem[];
  /** Level chip fallback for items that don't carry their own cefr_level. */
  activeLevel: string;
  /** cefr → colour lookup, resolved by the parent (same map the rows use). */
  levelColorFor: (level: string) => string;
  movieId: number | null;
  movieTitle?: string;
  targetLang: string;
  isAuthenticated: boolean;
  savedWords: Set<string>;
  onSave: (term: string) => void;
  /** Same handler as the rows' swipe-left; keeps the 5s undo snackbar. */
  onMarkLearned?: (term: string) => void;
  /** Explicit "Leave off here" — the rows' recordBookmark (toggle semantics). */
  onBookmark: (term: string) => void;
  /** Implicit cursor write on every advance (explicit: false). */
  onAdvanceBookmark: (term: string) => void;
  /** Rows' explicit bookmark word, so the pill can reflect the active state. */
  currentBookmarkWord?: string | null;
  /** Bookmarked word at screen load — the deck resumes from it. */
  initialWord?: string | null;
  /** Batch preview sentences (words only) — the same source the rows use. */
  sentencePreviews: Record<string, SentenceExample | undefined>;
  /** Reports the 1-based focused card number for the header progress row. */
  onCursorChange?: (cardNumber: number) => void;
}

const FLY_DURATION = 300;
const FLY_DISTANCE = 440;
const DRAG_CLAMP = 160;
const ACTION_SIZE = 54;
const ACTION_EDGE = 4;

/**
 * Card-deck view mode for the movie vocabulary screen (mockup 2a): one
 * focused card, two stacked edges behind it (pure styling), actions and
 * gestures mirroring the rows' swipes. Translations — word and sentence —
 * are fetched only when the user taps the card (the exact translate() +
 * enrichment path VocabRow's expansion uses) and cached per word, so
 * browsing the deck costs no translation calls.
 */
export const WordCardDeck = ({
  items,
  activeLevel,
  levelColorFor,
  movieId,
  movieTitle,
  targetLang,
  isAuthenticated,
  savedWords,
  onSave,
  onMarkLearned,
  onBookmark,
  onAdvanceBookmark,
  currentBookmarkWord,
  initialWord,
  sentencePreviews,
  onCursorChange,
}: WordCardDeckProps) => {
  const tc = useThemeColors();
  const s = useMemo(() => makeDeckStyles(tc), [tc]);
  const isPremium = useIsPremium();

  const keys = useMemo(() => items.map(keyOf), [items]);
  // NUL never appears in a word or idiom phrase, so the signature can't collide.
  const keySig = keys.join('\u0000');
  const itemByKey = useMemo(() => new Map(items.map((i) => [keyOf(i), i])), [items]);

  const [deck, dispatch] = useReducer(deckReducer, null, () =>
    restoreDeck(keys, initialWord ?? null),
  );
  const restoredRef = useRef(keys.length > 0);
  const [resumedAt, setResumedAt] = useState<number | null>(() =>
    initialWord && keys.includes(initialWord) ? keys.indexOf(initialWord) + 1 : null,
  );

  // Keep the committed state in step with the parent's item list (learned
  // words leaving, undo re-adding, previews resolving). `displayDeck` applies
  // the same pure sync during render so the frame the list shrinks never
  // shows a stale card while the effect commits.
  useEffect(() => {
    if (!restoredRef.current) {
      if (keys.length === 0) return;
      restoredRef.current = true;
      dispatch({ type: 'restore', keys, bookmarkWord: initialWord ?? null });
      if (initialWord && keys.includes(initialWord)) {
        setResumedAt(keys.indexOf(initialWord) + 1);
      }
      return;
    }
    dispatch({ type: 'sync', keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig]);

  const displayDeck = useMemo(() => deckReducer(deck, { type: 'sync', keys }), [deck, keys]);
  const currentKey = displayDeck.index >= 0 ? displayDeck.keys[displayDeck.index] : null;
  const currentItem = currentKey != null ? itemByKey.get(currentKey) : undefined;
  const total = displayDeck.keys.length;

  useEffect(() => {
    onCursorChange?.(displayDeck.index >= 0 ? displayDeck.index + 1 : 0);
  }, [displayDeck.index, onCursorChange]);

  // Reduce Motion: no fly animation, instant card swap.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const translateX = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const animatingRef = useRef(false);

  const flyOut = (dir: 1 | -1, done: () => void) => {
    if (reduceMotionRef.current) {
      translateX.setValue(0);
      done();
      return;
    }
    animatingRef.current = true;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: dir * FLY_DISTANCE,
        duration: FLY_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: FLY_DURATION - 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Reset BEFORE the state updates in done(): the incoming card remounts
      // (key={currentKey}) and must bind its native node to the rest values,
      // not the flown-out ones.
      translateX.setValue(0);
      cardOpacity.setValue(1);
      done();
      animatingRef.current = false;
    });
  };

  // Expansion state — which card revealed its translations, plus a per-word
  // cache so rotating back to a card never refetches.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, CardContent>>({});
  const [reportOpen, setReportOpen] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);

  const doAdvance = (method: 'swipe' | 'button') => {
    if (animatingRef.current || displayDeck.index < 0 || total === 0) return;
    track('deck_advance', { method });
    const nextKey = displayDeck.keys[(displayDeck.index + 1) % total];
    flyOut(1, () => {
      setResumedAt(null);
      setExpandedKey(null);
      dispatch({ type: 'advance' });
      onAdvanceBookmark(nextKey);
    });
  };

  const doLearn = (method: 'swipe' | 'button') => {
    if (animatingRef.current || displayDeck.index < 0 || !onMarkLearned || currentKey == null) {
      return;
    }
    track('deck_mark_learned', { method });
    const promoted = promotedKeyAfterRemoval(displayDeck, currentKey);
    const term = currentKey;
    flyOut(-1, () => {
      setResumedAt(null);
      setExpandedKey(null);
      onMarkLearned(term);
      if (promoted) onAdvanceBookmark(promoted);
    });
  };

  const doBookmark = () => {
    if (currentKey == null) return;
    track('deck_bookmark');
    onBookmark(currentKey);
  };

  // Refs so the PanResponder (captured once) always sees fresh handlers —
  // same pattern as BookmarkRowWrapper.
  const doAdvanceRef = useRef(doAdvance);
  doAdvanceRef.current = doAdvance;
  const doLearnRef = useRef(doLearn);
  doLearnRef.current = doLearn;
  const canLearnRef = useRef(!!onMarkLearned);
  canLearnRef.current = !!onMarkLearned;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !animatingRef.current && Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && Math.abs(g.dx) > 10,
      onPanResponderMove: (_, g) => {
        translateX.setValue(Math.max(-DRAG_CLAMP, Math.min(g.dx, DRAG_CLAMP)));
      },
      onPanResponderRelease: (_, g) => {
        const action = swipeDecision(g.dx);
        if (action === 'next') {
          doAdvanceRef.current('swipe');
          return;
        }
        if (action === 'learn' && canLearnRef.current) {
          doLearnRef.current('swipe');
          return;
        }
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  // Tap → reveal translations. Exact VocabRow expansion path: translate() for
  // the word + the enrichment sentences endpoint for the sentence translation,
  // gated behind the per-word cache. Never prefetches the rest of the deck.
  const handleCardPress = () => {
    if (currentKey == null || currentItem == null) return;
    const term = currentKey;
    if (expandedKey === term) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(term);
    if (isAuthenticated) {
      wordwiseApi.logInteraction(term, 'ROW_CLICK', movieId);
    }
    if (content[term]) return;

    let translation: string | null = null;
    let enrichment: SentenceExample | null = null;
    const promises: Promise<void>[] = [];
    promises.push(
      wordwiseApi
        .translate(term, targetLang || 'ES', undefined, movieId)
        .then((result) => {
          translation = result.translated;
        })
        .catch(() => {
          translation = 'Translation failed';
        }),
    );
    if (movieId) {
      const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
      promises.push(
        authFetch(
          `${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(term)}?max_examples=1${langParam}`,
        )
          .then((res) => res.json())
          .then((data) => {
            if (data.sentences && Array.isArray(data.sentences) && data.sentences.length > 0) {
              enrichment = data.sentences[0];
            }
          })
          .catch(() => {}),
      );
    }
    Promise.all(promises).then(() => {
      setContent((prev) => ({ ...prev, [term]: { translation, enrichment, loaded: true } }));
    });
  };

  const handlePronounce = async () => {
    if (playingAudio || currentKey == null) return;
    setPlayingAudio(true);
    try {
      const { Audio } = require('expo-av');
      const { sound } = await Audio.Sound.createAsync(
        { uri: premiumApi.pronounceUrl(currentKey) },
        { shouldPlay: true },
      );
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          setPlayingAudio(false);
        }
      });
    } catch {
      setPlayingAudio(false);
    }
  };

  if (total === 0 || currentItem == null || currentKey == null) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyText}>No words in this deck yet.</Text>
      </View>
    );
  }

  const idiom = isIdiomItem(currentItem);
  const badge = idiom
    ? (currentItem as IdiomInfo).type === 'phrasal_verb'
      ? 'phrasal verb'
      : 'idiom'
    : null;
  const level = (
    (currentItem as { cefr_level?: string }).cefr_level || activeLevel
  ).toUpperCase();
  const levelColor = levelColorFor(level);

  const cardContent = content[currentKey];
  const expanded = expandedKey === currentKey;
  const expansionLoading = expanded && !cardContent?.loaded;
  const translation = cardContent?.translation ?? null;
  const isUntranslatable =
    !!translation && translation.toLowerCase() === currentKey.toLowerCase();
  const enrichment = cardContent?.enrichment ?? null;

  // Same source-of-truth swap as VocabRow: batch preview while collapsed,
  // enrichment sentence once it has loaded. Idioms only get the enrichment.
  const preview = !idiom ? sentencePreviews[currentKey] : undefined;
  const collapsedSentence = preview && preview.sentence ? preview : null;
  const visibleSentence = !idiom && cardContent?.loaded && enrichment ? enrichment : collapsedSentence;
  const previewLoading = !idiom && preview === undefined;
  const sentenceTranslation = expanded && cardContent?.loaded ? enrichment?.translation || null : null;

  const isSaved = savedWords.has(currentKey);
  const isBookmarked = currentBookmarkWord === currentKey;

  return (
    <View style={s.wrap}>
      {resumedAt != null ? (
        <View style={s.resumeChip}>
          <Text style={s.resumeChipText}>⚑ Resumed at your bookmark · card {resumedAt}</Text>
        </View>
      ) : null}

      <View style={s.deckWrap}>
        {/* Stacked edges — pure styling, not real cards. */}
        {total > 2 ? (
          <View
            style={[s.stackEdge, { opacity: 0.45, transform: [{ translateY: -16 }, { scale: 0.92 }] }]}
            pointerEvents="none"
          />
        ) : null}
        {total > 1 ? (
          <View
            style={[s.stackEdge, { opacity: 0.7, transform: [{ translateY: -8 }, { scale: 0.96 }] }]}
            pointerEvents="none"
          />
        ) : null}

        <Animated.View
          // Remount per word: a fresh native Animated node starts from the
          // (reset) JS-side values, so a completed fly-out can never leave the
          // next card stuck off-screen.
          key={currentKey}
          style={[s.card, { transform: [{ translateX }], opacity: cardOpacity }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCardPress}
            accessibilityRole="button"
            accessibilityHint="Shows the translation"
          >
            {/* top row: rank · level chip · spacer · save star */}
            <View style={s.topRow}>
              <Text style={s.rank}>{displayDeck.index + 1}</Text>
              <View style={[s.levelChip, { backgroundColor: `${levelColor}22` }]}>
                <Text style={[s.levelChipText, { color: levelColor }]}>{level}</Text>
              </View>
              {badge ? (
                <View style={[s.levelChip, { backgroundColor: `${levelColor}14` }]}>
                  <Text style={[s.levelChipText, { color: levelColor }]}>{badge}</Text>
                </View>
              ) : null}
              <View style={s.flexSpacer} />
              {isAuthenticated ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation();
                    onSave(currentKey);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={isSaved ? 'Remove from saved' : 'Save word'}
                >
                  <Text style={[s.star, isSaved && s.starActive]}>{isSaved ? '★' : '☆'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* word line — translation lands inline after a tap */}
            <View style={s.wordLine}>
              <Text style={s.word}>{currentKey}</Text>
              {expanded ? (
                cardContent?.loaded ? (
                  translation && !isUntranslatable ? (
                    <>
                      <Text style={s.translation}>
                        <Text style={s.translationDot}>· </Text>
                        {translation.toLowerCase()}
                      </Text>
                      <View style={s.langChip}>
                        <Text style={s.langChipText}>{(targetLang || 'ES').toUpperCase()}</Text>
                      </View>
                    </>
                  ) : null
                ) : (
                  <View style={s.translationSkeleton} />
                )
              ) : null}
            </View>

            {/* sentence-in-context with the highlighted target word */}
            {visibleSentence ? (
              renderHighlighted(
                visibleSentence.sentence,
                currentKey,
                visibleSentence.matched_form,
                levelColor,
                s.sentence,
                s.sentenceHi,
              )
            ) : previewLoading || (idiom && expansionLoading) ? (
              <View style={s.sentenceSkeletonWrap}>
                <View style={[s.skelBar, { width: '92%' }]} />
                <View style={[s.skelBar, { width: '64%', marginTop: 7 }]} />
              </View>
            ) : idiom && expanded && cardContent?.loaded && !enrichment ? (
              <Text style={s.noExamples}>No sentence examples available</Text>
            ) : null}

            {/* sentence translation under a gold left bar — on-demand only */}
            {sentenceTranslation ? (
              <View style={s.sentenceTranslationBlock}>
                <Text style={s.sentenceTranslation}>{sentenceTranslation}</Text>
              </View>
            ) : expanded && expansionLoading && !idiom ? (
              <View style={s.sentenceSkeletonWrap}>
                <View style={[s.skelBar, { width: '78%', height: 11 }]} />
              </View>
            ) : null}

            {/* footer: report + pronounce, same handlers as the expanded row */}
            <View style={s.footerRow}>
              {isAuthenticated ? (
                <Text
                  style={s.actionText}
                  onPress={() => setReportOpen(true)}
                  accessibilityRole="button"
                >
                  ⚐ Report an issue
                </Text>
              ) : null}
              {isPremium && !idiom ? (
                <Text
                  style={[s.actionText, s.pronounceIcon, playingAudio && s.pronounceActive]}
                  onPress={handlePronounce}
                  accessibilityRole="button"
                  accessibilityLabel="Pronounce word"
                >
                  {playingAudio ? '…' : '🔊'}
                </Text>
              ) : null}
              {!expanded ? <Text style={s.tapHint}>tap for translation</Text> : null}
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* actions under the deck — buttons fully cover the gesture actions */}
      <View style={s.actionsRow}>
        {onMarkLearned ? (
          <PressableScale
            style={s.learnCircle}
            onPress={() => doLearn('button')}
            accessibilityRole="button"
            accessibilityLabel="I know this"
          >
            <Ionicons name="checkmark" size={26} color={tc.success} />
          </PressableScale>
        ) : null}

        <PressableScale
          style={[s.bookmarkPill, isBookmarked && s.bookmarkPillActive]}
          onPress={doBookmark}
          accessibilityRole="button"
          accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Leave off here'}
        >
          <Text style={[s.bookmarkPillText, isBookmarked && s.bookmarkPillTextActive]}>
            {isBookmarked ? '⚑ Bookmarked here' : '⚑ Leave off here'}
          </Text>
        </PressableScale>

        <PressableScale
          style={s.nextButton}
          onPress={() => doAdvance('button')}
          accessibilityRole="button"
          accessibilityLabel="Next card"
        >
          <View style={s.nextEdge} />
          <View style={s.nextFace}>
            <Ionicons name="arrow-forward" size={24} color={tc.goldDeep} />
          </View>
        </PressableScale>
      </View>

      <Text style={s.gestureHint}>
        swipe left = I know this · swipe right = next
      </Text>

      <ReportDialog
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        word={currentKey}
        movieId={movieId ?? undefined}
        movieTitle={movieTitle}
      />
    </View>
  );
};

const makeDeckStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      paddingTop: 10,
      paddingBottom: 110,
    },
    resumeChip: {
      alignSelf: 'center',
      backgroundColor: `${tc.gold}1F`,
      borderWidth: 1,
      borderColor: `${tc.gold}66`,
      borderRadius: 999,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    resumeChipText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: tc.goldOnSurface,
    },
    deckWrap: {
      marginHorizontal: 18,
      marginTop: 18,
    },
    stackEdge: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
    },
    card: {
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
      padding: 20,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    rank: {
      fontFamily: MONO_FAMILY,
      fontSize: 12,
      fontWeight: '700',
      color: tc.textFaint,
    },
    levelChip: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 5,
    },
    levelChipText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    flexSpacer: {
      flex: 1,
    },
    star: {
      fontSize: 22,
      lineHeight: 24,
      color: tc.textFaint,
      opacity: 0.5,
    },
    starActive: {
      color: tc.gold,
      opacity: 1,
    },
    wordLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      marginTop: 14,
    },
    word: {
      fontFamily: SERIF_FAMILY,
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: -0.5,
      color: tc.text,
    },
    translation: {
      fontFamily: SERIF_FAMILY,
      fontSize: 19,
      fontWeight: '600',
      fontStyle: 'italic',
      color: tc.primaryOnSurface,
      marginLeft: 8,
    },
    translationDot: {
      fontFamily: SERIF_FAMILY,
      fontStyle: 'normal',
      color: tc.textFaint,
    },
    translationSkeleton: {
      width: 88,
      height: 14,
      borderRadius: 4,
      backgroundColor: tc.skeleton,
      marginLeft: 8,
      alignSelf: 'center',
    },
    langChip: {
      backgroundColor: tc.chipBg,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
      marginLeft: 8,
      alignSelf: 'center',
    },
    langChipText: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: tc.textSecondary,
    },
    sentence: {
      fontFamily: SERIF_FAMILY,
      fontSize: 17,
      lineHeight: 26,
      color: tc.textSecondary,
      marginTop: 14,
    },
    sentenceHi: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      fontStyle: 'italic',
    },
    sentenceSkeletonWrap: {
      marginTop: 14,
    },
    skelBar: {
      height: 13,
      borderRadius: 4,
      backgroundColor: tc.skeleton,
    },
    sentenceTranslationBlock: {
      marginTop: 12,
      borderLeftWidth: 2,
      borderLeftColor: tc.gold,
      paddingLeft: 10,
    },
    sentenceTranslation: {
      fontFamily: SERIF_FAMILY,
      fontSize: 15,
      lineHeight: 22,
      fontStyle: 'italic',
      color: tc.textSecondary,
    },
    noExamples: {
      fontFamily: SERIF_FAMILY,
      fontSize: 14,
      fontStyle: 'italic',
      color: tc.textFaint,
      marginTop: 14,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
      marginTop: 18,
    },
    actionText: {
      fontSize: 11,
      fontWeight: '600',
      color: tc.textFaint,
    },
    pronounceIcon: {
      fontSize: 14,
    },
    pronounceActive: {
      opacity: 0.5,
    },
    tapHint: {
      marginLeft: 'auto',
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.3,
      color: tc.textFaint,
      opacity: 0.8,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      marginTop: 26,
      marginHorizontal: 18,
    },
    learnCircle: {
      width: ACTION_SIZE,
      height: ACTION_SIZE,
      borderRadius: ACTION_SIZE / 2,
      borderWidth: 2,
      borderColor: tc.success,
      backgroundColor: tc.paper,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bookmarkPill: {
      paddingVertical: 14,
      paddingHorizontal: 18,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.paper,
    },
    bookmarkPillActive: {
      borderColor: `${tc.gold}88`,
      backgroundColor: `${tc.gold}1F`,
    },
    bookmarkPillText: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.2,
      color: tc.text,
    },
    bookmarkPillTextActive: {
      color: tc.goldOnSurface,
    },
    // Gold next button with the PracticeTile face/edge 3D pattern.
    nextButton: {
      width: ACTION_SIZE,
      height: ACTION_SIZE + ACTION_EDGE,
    },
    nextEdge: {
      position: 'absolute',
      top: ACTION_EDGE,
      left: 0,
      width: ACTION_SIZE,
      height: ACTION_SIZE,
      borderRadius: ACTION_SIZE / 2,
      backgroundColor: tc.nodeGoldEdge,
    },
    nextFace: {
      width: ACTION_SIZE,
      height: ACTION_SIZE,
      borderRadius: ACTION_SIZE / 2,
      backgroundColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    gestureHint: {
      marginTop: 14,
      textAlign: 'center',
      fontSize: 11,
      color: tc.textFaint,
    },
    emptyWrap: {
      marginHorizontal: 18,
      marginTop: 24,
      paddingVertical: 40,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      alignItems: 'center',
    },
    emptyText: {
      fontFamily: SERIF_FAMILY,
      fontSize: 15,
      fontStyle: 'italic',
      color: tc.textFaint,
    },
  });

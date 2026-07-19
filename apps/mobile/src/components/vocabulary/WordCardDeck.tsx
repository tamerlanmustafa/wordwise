import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
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
  shouldClaimHorizontalDrag,
  peekNextIndex,
  promotedKeyAfterRemoval,
  STACK_SLOTS,
  type StackSlot,
} from './deckLogic';

// Same easing/duration family as VocabRow's expansion so the card growing on
// tap feels like the rows did.
const EXPAND_ANIM = {
  duration: 220,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};
const REVEAL_ANIM = {
  duration: 180,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};
// Eases the wrapper-height change between consecutive cards at the swap
// instead of snapping. Update-only on purpose: the incoming card's opacity
// and transform are Animated-bound, so create/delete fades would fight the
// native nodes.
const SWAP_ANIM = {
  duration: 200,
  update: { type: 'easeInEaseOut' as const },
};

/**
 * Interpolated style that slides a stack layer from its resting slot to the
 * one in front as `promote` runs 0 → 1 during the focused card's fly-out.
 */
const liftStyle = (promote: Animated.Value, from: StackSlot, to: StackSlot) => ({
  opacity: promote.interpolate({ inputRange: [0, 1], outputRange: [from.opacity, to.opacity] }),
  transform: [
    {
      translateY: promote.interpolate({
        inputRange: [0, 1],
        outputRange: [from.translateY, to.translateY],
      }),
    },
    { scale: promote.interpolate({ inputRange: [0, 1], outputRange: [from.scale, to.scale] }) },
  ],
});

interface OutgoingCardProps {
  id: number;
  dir: 1 | -1;
  /** Drag offset at release — the overlay picks up exactly where the finger let go. */
  startX: number;
  onDone: (id: number) => void;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * A card detached from the deck at the moment of a swipe commit: it finishes
 * the fly-out on its own fresh Animated values and removes itself. Keeping
 * the flight off the interactive card is what lets the next slide start
 * immediately — and there is no shared native state left to race.
 */
const OutgoingCard = ({ id, dir, startX, onDone, style, children }: OutgoingCardProps) => {
  const translateX = useRef(new Animated.Value(startX)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: dir * FLY_DISTANCE,
        duration: FLY_DURATION,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FLY_DURATION - 40,
        useNativeDriver: true,
      }),
    ]).start(() => onDoneRef.current(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View pointerEvents="none" style={[style, { transform: [{ translateX }], opacity }]}>
      {children}
    </Animated.View>
  );
};

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
  /** Cursor write on every advance (explicit: false). The top card IS the
   *  bookmark — leaving the screen resumes from whatever was in focus. */
  onAdvanceBookmark: (term: string) => void;
  /** Bookmarked word at screen load — the deck resumes from it. */
  initialWord?: string | null;
  /** Batch preview sentences (words only) — the same source the rows use. */
  sentencePreviews: Record<string, SentenceExample | undefined>;
  /** Reports the 1-based focused card number for the header progress row. */
  onCursorChange?: (cardNumber: number) => void;
  /** Fires when a card drag starts/ends so the parent can freeze its
   *  vertical scroll — otherwise the ScrollView pans under the slide. */
  onDragStateChange?: (dragging: boolean) => void;
}

const FLY_DURATION = 300;
const FLY_DISTANCE = 440;
/** The stack stepping one slot forward after a commit. */
const ARRIVE_DURATION = 220;
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
  onAdvanceBookmark,
  initialWord,
  sentencePreviews,
  onCursorChange,
  onDragStateChange,
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

  // Advances commit IMMEDIATELY on release — the outgoing card keeps flying
  // as a detached overlay (OutgoingCard, fresh values per overlay) while the
  // new focused card is interactive at once, so rapid consecutive slides
  // never wait on an animation. Per-key values here avoid the shared-native-
  // node races that used to strand or flash cards at the swap.
  //
  // `arrive` (0 → 1 on mount) plays the enter choreography for the commit
  // that created this key: 'step' slides the whole stack one slot forward,
  // 'return' flies an undone card back in from the right.
  const nextMountAnimRef = useRef<'step' | 'return' | null>(null);
  const animRef = useRef<{
    key: string;
    translateX: Animated.Value;
    focusOpacity: Animated.Value;
    arrive: Animated.Value;
    mode: 'step' | 'return' | null;
    // transform mixes translateX/translateY/scale interpolations depending
    // on the mode, which RN's WithAnimatedObject unions can't express.
    focusedArrive: { opacity: Animated.AnimatedInterpolation<number>; transform: any[] };
    focusedOpacity: Animated.AnimatedMultiplication<number>;
    behindArrive: ReturnType<typeof liftStyle> | null;
  } | null>(null);
  const focusedKey = displayDeck.index >= 0 ? displayDeck.keys[displayDeck.index] : '';
  if (animRef.current == null || animRef.current.key !== focusedKey) {
    const mode = reduceMotionRef.current ? null : nextMountAnimRef.current;
    nextMountAnimRef.current = null;
    const arrive = new Animated.Value(mode == null ? 1 : 0);
    const focusOpacity = new Animated.Value(1);
    const focusedArrive =
      mode === 'return'
        ? {
            opacity: arrive.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
            transform: [
              {
                translateX: arrive.interpolate({
                  inputRange: [0, 1],
                  outputRange: [FLY_DISTANCE, 0],
                }),
              },
            ],
          }
        : liftStyle(arrive, STACK_SLOTS[mode === 'step' ? 1 : 0], STACK_SLOTS[0]);
    animRef.current = {
      key: focusedKey,
      translateX: new Animated.Value(0),
      focusOpacity,
      arrive,
      mode,
      focusedArrive,
      // The imperative learn-hide multiplies in, on a node built once per
      // key so mid-animation re-renders rebind the same graph.
      focusedOpacity: Animated.multiply(
        focusOpacity,
        focusedArrive.opacity as Animated.AnimatedInterpolation<number>,
      ),
      behindArrive: mode === 'step' ? liftStyle(arrive, STACK_SLOTS[2], STACK_SLOTS[1]) : null,
    };
  }
  const { translateX, focusOpacity, focusedArrive, focusedOpacity, behindArrive } =
    animRef.current;

  // Play the enter choreography once per mounted key.
  useEffect(() => {
    const anim = animRef.current;
    if (anim == null || anim.mode == null) return;
    if (reduceMotionRef.current) {
      anim.arrive.setValue(1);
      return;
    }
    Animated.timing(anim.arrive, {
      toValue: 1,
      duration: anim.mode === 'return' ? FLY_DURATION : ARRIVE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focusedKey]);

  // Cards mid-flight after a swipe: each overlay owns its own values and
  // removes itself when the fly-out finishes.
  const [outgoing, setOutgoing] = useState<
    { id: number; dir: 1 | -1; startX: number; item: DeckItem; rank: number }[]
  >([]);
  const outgoingIdRef = useRef(0);
  const handleOutgoingDone = useCallback((id: number) => {
    setOutgoing((prev) => prev.filter((o) => o.id !== id));
  }, []);
  // Last clamped drag offset — where the overlay picks up when the finger
  // lets go mid-drag (button advances fly from center).
  const lastDragXRef = useRef(0);

  // Keys swiped past with "next", most recent last — the undo button walks
  // this back. Learned words keep their own undo (the parent's toast).
  const undoStackRef = useRef<string[]>([]);

  // Expansion state — which card revealed its translations, plus a per-word
  // cache so rotating back to a card never refetches.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, CardContent>>({});
  const [reportOpen, setReportOpen] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);

  /** Detach the focused card into a fly-away overlay (skipped under Reduce
   *  Motion, where the swap is instant). */
  const pushOutgoing = (dir: 1 | -1, startX: number) => {
    if (reduceMotionRef.current || currentItem == null) return;
    setOutgoing((prev) => [
      ...prev,
      {
        id: outgoingIdRef.current++,
        dir,
        startX,
        item: currentItem,
        rank: displayDeck.index + 1,
      },
    ]);
  };

  const doAdvance = (method: 'swipe' | 'button') => {
    if (displayDeck.index < 0 || total === 0 || currentKey == null) return;
    if (total === 1) {
      // Only card in rotation: nothing to advance to — settle back.
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      return;
    }
    track('deck_advance', { method });
    const nextKey = displayDeck.keys[(displayDeck.index + 1) % total];
    pushOutgoing(1, method === 'swipe' ? lastDragXRef.current : 0);
    undoStackRef.current.push(currentKey);
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    if (!reduceMotionRef.current) LayoutAnimation.configureNext(SWAP_ANIM);
    nextMountAnimRef.current = 'step';
    setResumedAt(null);
    setExpandedKey(null);
    dispatch({ type: 'advance' });
    onAdvanceBookmark(nextKey);
  };

  const doLearn = (method: 'swipe' | 'button') => {
    if (displayDeck.index < 0 || !onMarkLearned || currentKey == null) return;
    track('deck_mark_learned', { method });
    const promoted = promotedKeyAfterRemoval(displayDeck, currentKey);
    const term = currentKey;
    pushOutgoing(-1, method === 'swipe' ? lastDragXRef.current : 0);
    // The item list shrinks via the parent, so the remount lags this commit
    // by a beat — hide the focused card NOW so it never doubles the overlay.
    focusOpacity.setValue(0);
    if (!reduceMotionRef.current) LayoutAnimation.configureNext(SWAP_ANIM);
    nextMountAnimRef.current = 'step';
    setResumedAt(null);
    setExpandedKey(null);
    onMarkLearned(term);
    if (promoted) onAdvanceBookmark(promoted);
  };

  /** Undo button: bring back the last "next"-swiped card that is still in
   *  the deck; it flies back in from the right. */
  const doUndo = () => {
    const stack = undoStackRef.current;
    let key: string | undefined;
    while ((key = stack.pop()) != null) {
      if (key !== currentKey && displayDeck.keys.includes(key)) break;
    }
    if (key == null) return;
    track('deck_undo', {});
    if (!reduceMotionRef.current) LayoutAnimation.configureNext(SWAP_ANIM);
    nextMountAnimRef.current = 'return';
    setResumedAt(null);
    setExpandedKey(null);
    dispatch({ type: 'focus', key });
    onAdvanceBookmark(key);
  };

  const canUndo = undoStackRef.current.some(
    (k) => k !== currentKey && displayDeck.keys.includes(k),
  );

  // Refs so the PanResponder (captured once) always sees fresh handlers —
  // same pattern as BookmarkRowWrapper.
  const doAdvanceRef = useRef(doAdvance);
  doAdvanceRef.current = doAdvance;
  const doLearnRef = useRef(doLearn);
  doLearnRef.current = doLearn;
  const canLearnRef = useRef(!!onMarkLearned);
  canLearnRef.current = !!onMarkLearned;
  const onDragStateChangeRef = useRef(onDragStateChange);
  onDragStateChangeRef.current = onDragStateChange;
  // If the deck unmounts mid-drag (tab/sort remount), release the parent's
  // scroll lock so the screen doesn't stay frozen.
  useEffect(() => () => onDragStateChangeRef.current?.(false), []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => shouldClaimHorizontalDrag(g.dx, g.dy),
      // Once the card owns the drag, keep it — don't let the enclosing
      // ScrollView steal the responder mid-slide.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        onDragStateChangeRef.current?.(true);
      },
      onPanResponderMove: (_, g) => {
        const x = Math.max(-DRAG_CLAMP, Math.min(g.dx, DRAG_CLAMP));
        lastDragXRef.current = x;
        animRef.current?.translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        onDragStateChangeRef.current?.(false);
        const action = swipeDecision(g.dx);
        if (action === 'next') {
          doAdvanceRef.current('swipe');
          return;
        }
        if (action === 'learn' && canLearnRef.current) {
          doLearnRef.current('swipe');
          return;
        }
        if (animRef.current) {
          Animated.spring(animRef.current.translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        onDragStateChangeRef.current?.(false);
        if (animRef.current) {
          Animated.spring(animRef.current.translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  // Tap → reveal translations. Exact VocabRow expansion path: translate() for
  // the word + the enrichment sentences endpoint for the sentence translation,
  // gated behind the per-word cache. Never prefetches the rest of the deck.
  const handleCardPress = () => {
    if (currentKey == null || currentItem == null) return;
    const term = currentKey;
    // Grow/shrink the card smoothly rather than snapping to the new height.
    if (!reduceMotionRef.current) LayoutAnimation.configureNext(EXPAND_ANIM);
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
      if (!reduceMotionRef.current) LayoutAnimation.configureNext(REVEAL_ANIM);
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

  // The card behind the focused one shows its REAL content (collapsed
  // anatomy), so a slow drag reveals what's coming instead of a blank sheet.
  const behindIndex = peekNextIndex(displayDeck);
  const behindItem =
    behindIndex >= 0 ? itemByKey.get(displayDeck.keys[behindIndex]) : undefined;

  const renderStaticBody = (item: DeckItem, rankNumber: number) => {
    const staticIdiom = isIdiomItem(item);
    const term = keyOf(item);
    const lvl = ((item as { cefr_level?: string }).cefr_level || activeLevel).toUpperCase();
    const lvlColor = levelColorFor(lvl);
    const staticBadge = staticIdiom
      ? (item as IdiomInfo).type === 'phrasal_verb'
        ? 'phrasal verb'
        : 'idiom'
      : null;
    const staticPreview = !staticIdiom ? sentencePreviews[term] : undefined;
    const staticSentence = staticPreview && staticPreview.sentence ? staticPreview : null;
    return (
      <>
        <View style={s.topRow}>
          <Text style={s.rank}>{rankNumber}</Text>
          <View style={[s.levelChip, { backgroundColor: `${lvlColor}22` }]}>
            <Text style={[s.levelChipText, { color: lvlColor }]}>{lvl}</Text>
          </View>
          {staticBadge ? (
            <View style={[s.levelChip, { backgroundColor: `${lvlColor}14` }]}>
              <Text style={[s.levelChipText, { color: lvlColor }]}>{staticBadge}</Text>
            </View>
          ) : null}
          <View style={s.flexSpacer} />
          <Text style={[s.star, savedWords.has(term) && s.starActive]}>
            {savedWords.has(term) ? '★' : '☆'}
          </Text>
        </View>
        <View style={s.wordLine}>
          <Text style={s.word}>{term}</Text>
        </View>
        {staticSentence ? (
          renderHighlighted(
            staticSentence.sentence,
            term,
            staticSentence.matched_form,
            lvlColor,
            s.sentence,
            s.sentenceHi,
          )
        ) : !staticIdiom ? (
          <View style={s.sentenceSkeletonWrap}>
            <View style={[s.skelBar, { width: '92%' }]} />
            <View style={[s.skelBar, { width: '64%', marginTop: 7 }]} />
          </View>
        ) : null}
        {/* Mirror the collapsed focused card's footer exactly: the promoted
            card hands off to the real one at the swap, and any element
            missing here would pop in at that instant. */}
        <View style={s.footerRow}>
          {isAuthenticated ? <Text style={s.actionText}>⚐ Report an issue</Text> : null}
          {isPremium && !staticIdiom ? (
            <Text style={[s.actionText, s.pronounceIcon]}>🔊</Text>
          ) : null}
          <Text style={s.tapHint}>tap for translation</Text>
        </View>
      </>
    );
  };

  return (
    <View style={s.wrap}>
      {resumedAt != null ? (
        <View style={s.resumeChip}>
          <Text style={s.resumeChipText}>⚑ Resumed at your bookmark · card {resumedAt}</Text>
        </View>
      ) : null}

      <View style={s.deckWrap}>
        {/* Second edge stays pure styling; the first is the next card's
            real content, clipped to the focused card's footprint. On a
            'step' commit the behind card arrives from the edge slot while
            the focused card arrives from the behind slot — the stack reads
            as one forward motion. */}
        {total > 2 ? <View style={[s.stackEdge, s.edgeRest]} pointerEvents="none" /> : null}
        {behindItem != null ? (
          <Animated.View
            key={`behind-${displayDeck.keys[behindIndex]}`}
            style={[s.stackEdge, s.behindCard, behindArrive ?? s.behindRest]}
            pointerEvents="none"
          >
            {renderStaticBody(behindItem, behindIndex + 1)}
          </Animated.View>
        ) : null}

        <Animated.View
          // Remount per word, paired with the per-key Animated.Values above:
          // each card gets a fresh native view bound to fresh nodes.
          key={currentKey}
          style={[
            s.card,
            {
              transform: [{ translateX }, ...focusedArrive.transform],
              opacity: focusedOpacity,
            },
          ]}
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

        {/* Cards mid-flight after a swipe fly above the (already
            interactive) new focused card. */}
        {outgoing.map((o) => (
          <OutgoingCard
            key={o.id}
            id={o.id}
            dir={o.dir}
            startX={o.startX}
            onDone={handleOutgoingDone}
            style={s.outgoingCard}
          >
            {renderStaticBody(o.item, o.rank)}
          </OutgoingCard>
        ))}
      </View>

      {/* actions under the deck — buttons fully cover the gesture actions */}
      <View style={s.actionsRow}>
        {onMarkLearned ? (
          <View style={s.actionColumn}>
            <PressableScale
              style={s.learnCircle}
              onPress={() => doLearn('button')}
              accessibilityRole="button"
              accessibilityLabel="I know this"
            >
              <Ionicons name="checkmark" size={26} color={tc.success} />
            </PressableScale>
            <Text style={s.actionCaption}>I know this</Text>
          </View>
        ) : null}

        <View style={s.spacerColumn} />

        <PressableScale
          style={[s.undoCircle, !canUndo && s.undoDisabled]}
          onPress={doUndo}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel="Bring back the previous card"
        >
          <Ionicons name="arrow-undo" size={20} color={tc.textSecondary} />
        </PressableScale>

        <View style={s.spacerColumn} />

        <View style={s.actionColumn}>
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
          <Text style={s.actionCaption}>Next</Text>
        </View>
      </View>

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
    behindCard: {
      overflow: 'hidden',
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    // Resting looks for the stack slots (animated variants interpolate
    // between the same STACK_SLOTS values).
    behindRest: {
      opacity: STACK_SLOTS[1].opacity,
      transform: [{ translateY: STACK_SLOTS[1].translateY }, { scale: STACK_SLOTS[1].scale }],
    },
    edgeRest: {
      opacity: STACK_SLOTS[2].opacity,
      transform: [{ translateY: STACK_SLOTS[2].translateY }, { scale: STACK_SLOTS[2].scale }],
    },
    // A swiped card mid-flight: same face as the focused card, clipped to
    // the deck footprint, floating above the new focused card.
    outgoingCard: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
      paddingHorizontal: 20,
      paddingTop: 20,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
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
      alignItems: 'flex-start',
      justifyContent: 'space-around',
      marginTop: 28,
      marginHorizontal: 18,
    },
    actionColumn: {
      alignItems: 'center',
      gap: 8,
    },
    spacerColumn: {
      flex: 1,
    },
    actionCaption: {
      fontSize: 12,
      fontWeight: '600',
      color: tc.textSecondary,
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
    // Icon-only undo between the two main actions; margin centers it on
    // the same axis as the 54pt circles.
    undoCircle: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1.5,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: (ACTION_SIZE - 46) / 2,
    },
    undoDisabled: {
      opacity: 0.35,
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

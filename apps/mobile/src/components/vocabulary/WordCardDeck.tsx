import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, useColorScheme } from '../../theme/tokens';
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
import { track } from '../../services/analytics';
import { renderHighlighted, type SentenceExample } from './VocabRow';
import {
  deckReducer,
  restoreDeck,
  swipeDecision,
  shouldClaimHorizontalDrag,
  promotedKeyAfterRemoval,
  STACK_SLOTS,
  type StackSlot,
} from './deckLogic';
import {
  CARD_HEIGHT,
  DECK_ZONE_HEIGHT,
  STACK_HEADROOM,
  GHOSTS,
  META_ROW_HEIGHT,
  WORD_SLOT_TOP,
  WORD_SLOT_HEIGHT,
  WORD_TR_SLOT_TOP,
  WORD_TR_SLOT_HEIGHT,
  DIVIDER_TOP,
  DIVIDER_HEIGHT,
  SENTENCE_SLOT_TOP,
  SENTENCE_SLOT_HEIGHT,
  SENTENCE_TR_SLOT_TOP,
  SENTENCE_TR_SLOT_HEIGHT,
  FOOTER_TOP,
  FOOTER_HEIGHT,
  REVEAL_IN_MS,
  REVEAL_OUT_MS,
  REVEAL_RISE_PX,
  B1_HIGHLIGHT,
  wordTier,
  wordTranslationTier,
  sentenceTier,
  sentenceTranslationTier,
} from './cardLayout';

/**
 * Interpolated style that slides the incoming focused card from the near-
 * ghost slot to the front as `promote` runs 0 → 1 after a commit.
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
 * the fly-out (drifting down 8px and tilting ±7° as it goes) on its own
 * fresh Animated values and removes itself. Keeping the flight off the
 * interactive card is what lets the next slide start immediately — and there
 * is no shared native state left to race.
 */
const OutgoingCard = ({ id, dir, startX, onDone, style, children }: OutgoingCardProps) => {
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: FLY_DURATION,
        easing: Easing.bezier(0.35, 0.1, 0.25, 1),
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
  const transform = [
    {
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [startX, dir * FLY_DISTANCE],
      }),
    },
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, FLY_DROP] }) },
    {
      rotate: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', `${dir * FLY_ROTATE_DEG}deg`],
      }),
    },
  ];
  return (
    <Animated.View pointerEvents="none" style={[style, { transform, opacity }]}>
      {children}
    </Animated.View>
  );
};

/**
 * Dashed horizontal rule that renders real dashes on iOS too: single-side
 * dashed borders draw solid there, so we clip an oversized dashed-border box
 * down to its top edge.
 */
const DashedRule = ({
  color,
  thickness = 1.5,
  style,
}: {
  color: string;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
}) => (
  <View style={[{ height: thickness, overflow: 'hidden' }, style]}>
    <View
      style={{
        height: thickness * 4,
        borderWidth: thickness,
        borderColor: color,
        borderStyle: 'dashed',
      }}
    />
  </View>
);

/** Same clip trick for the sentence-translation slot's dashed left border. */
const DashedLeftBorder = ({ color, width = 2 }: { color: string; width?: number }) => (
  <View
    pointerEvents="none"
    style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width, overflow: 'hidden' }}
  >
    <View
      style={{
        position: 'absolute',
        top: -width,
        bottom: -width,
        left: 0,
        width: width * 4,
        borderWidth: width,
        borderColor: color,
        borderStyle: 'dashed',
      }}
    />
  </View>
);

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
const FLY_DISTANCE = 430;
const FLY_DROP = 8;
const FLY_ROTATE_DEG = 7;
/** Incoming card settling from the ghost slot to the front. */
const ARRIVE_DURATION = 250;
const DRAG_CLAMP = 160;
const UNDO_STACK_MAX = 20;

// Tactile action buttons (Ledger mockup): a hard-edged "3D" shadow drawn as
// an offset edge layer; pressing translates the face down onto it.
const PILL_WIDTH = 136;
const PILL_HEIGHT = 52;
const PILL_EDGE = 4;
const PILL_EDGE_PRESSED_DROP = 3;
const UNDO_SIZE = 46;
const UNDO_EDGE = 3;

/**
 * Card-deck view mode for the movie vocabulary screen — the "Ledger Reveal"
 * design (mockup 1a): one fixed-height focused card over two ghost cards,
 * translation zones permanently reserved as dashed placeholder rules that a
 * tap fills in place (both word + sentence translations together, cross-fade,
 * zero layout shift). Translations are fetched only on the first reveal (the
 * exact translate() + enrichment path VocabRow's expansion used) and cached
 * per word, so browsing the deck costs no translation calls.
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
  const scheme = useColorScheme();
  const s = useMemo(() => makeDeckStyles(tc, scheme), [tc, scheme]);
  // Placeholder-rule dash colours (Ledger mockup); no light token matches.
  const dashColor = scheme === 'light' ? '#DCD2B8' : 'rgba(255,255,255,0.14)';
  const dashColorSoft = scheme === 'light' ? '#E3D9BE' : 'rgba(255,255,255,0.12)';
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

  // Reduce Motion: no fly animation, instant card swap and reveal.
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
  // that created this key: 'step' lifts the card from the near-ghost slot,
  // 'return' flies an undone card back in from the right. `reveal` drives
  // the translation cross-fade — per key, so it always starts hidden.
  const nextMountAnimRef = useRef<'step' | 'return' | null>(null);
  const animRef = useRef<{
    key: string;
    translateX: Animated.Value;
    focusOpacity: Animated.Value;
    arrive: Animated.Value;
    reveal: Animated.Value;
    revealHiddenOpacity: Animated.AnimatedInterpolation<number>;
    revealRise: Animated.AnimatedInterpolation<number>;
    mode: 'step' | 'return' | null;
    // transform mixes translateX/translateY/scale interpolations depending
    // on the mode, which RN's WithAnimatedObject unions can't express.
    focusedArrive: { opacity: Animated.AnimatedInterpolation<number>; transform: any[] };
    focusedOpacity: Animated.AnimatedMultiplication<number>;
  } | null>(null);
  const focusedKey = displayDeck.index >= 0 ? displayDeck.keys[displayDeck.index] : '';
  if (animRef.current == null || animRef.current.key !== focusedKey) {
    const mode = reduceMotionRef.current ? null : nextMountAnimRef.current;
    nextMountAnimRef.current = null;
    const arrive = new Animated.Value(mode == null ? 1 : 0);
    const focusOpacity = new Animated.Value(1);
    const reveal = new Animated.Value(0);
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
              {
                translateY: arrive.interpolate({
                  inputRange: [0, 1],
                  outputRange: [FLY_DROP, 0],
                }),
              },
              {
                rotate: arrive.interpolate({
                  inputRange: [0, 1],
                  outputRange: [`${FLY_ROTATE_DEG}deg`, '0deg'],
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
      reveal,
      revealHiddenOpacity: reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      revealRise: reveal.interpolate({ inputRange: [0, 1], outputRange: [REVEAL_RISE_PX, 0] }),
      mode,
      focusedArrive,
      // The imperative learn-hide multiplies in, on a node built once per
      // key so mid-animation re-renders rebind the same graph.
      focusedOpacity: Animated.multiply(
        focusOpacity,
        focusedArrive.opacity as Animated.AnimatedInterpolation<number>,
      ),
    };
  }
  const { translateX, focusOpacity, focusedArrive, focusedOpacity, revealHiddenOpacity, revealRise } =
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

  // Reveal state — which card shows its translations, plus a per-word cache
  // so rotating back to a card never refetches.
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
    if (undoStackRef.current.length > UNDO_STACK_MAX) undoStackRef.current.shift();
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

  // Tap → reveal BOTH translations together, in place. The sentence endpoint
  // returns the sentence, its translation, AND the word gloss aligned to that
  // translation (word_translation) — so the gloss matches the sentence and,
  // once cached server-side, the reveal costs nothing to repeat. We only fall
  // back to a standalone translate() call when no aligned gloss is available
  // (idioms, words with no example, or alignment unavailable). Gated behind
  // the per-word cache; never prefetches the rest of the deck.
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

    const isIdiom = isIdiomItem(currentItem);
    // Context for the fallback translate(): the example sentence shown on the
    // card, so even the fallback biases toward the in-sentence sense.
    const contextSentence = !isIdiom
      ? sentencePreviews[term]?.sentence || undefined
      : undefined;

    (async () => {
      let enrichment: SentenceExample | null = null;
      if (movieId) {
        const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
        try {
          const res = await authFetch(
            `${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(term)}?max_examples=1${langParam}`,
          );
          const data = await res.json();
          if (data.sentences && Array.isArray(data.sentences) && data.sentences.length > 0) {
            enrichment = data.sentences[0];
          }
        } catch {}
      }

      // Prefer the aligned gloss; only pay for a standalone translation when
      // the server couldn't provide one.
      let translation: string | null = enrichment?.word_translation ?? null;
      if (!translation) {
        try {
          const result = await wordwiseApi.translate(
            term,
            targetLang || 'ES',
            undefined,
            movieId,
            contextSentence,
          );
          translation = result.translated;
        } catch {
          translation = 'Translation failed';
        }
      }

      setContent((prev) => ({ ...prev, [term]: { translation, enrichment, loaded: true } }));
    })();
  };

  const cardContent = currentKey != null ? content[currentKey] : undefined;
  const expanded = currentKey != null && expandedKey === currentKey;
  const contentLoaded = !!cardContent?.loaded;

  // The cross-fade waits for the fetch: dashed placeholders hold the slots
  // until both translations are ready, then fill together in one motion.
  const revealOn = expanded && contentLoaded;
  useEffect(() => {
    const anim = animRef.current;
    if (anim == null) return;
    if (reduceMotionRef.current) {
      anim.reveal.setValue(revealOn ? 1 : 0);
      return;
    }
    Animated.timing(anim.reveal, {
      toValue: revealOn ? 1 : 0,
      duration: revealOn ? REVEAL_IN_MS : REVEAL_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [revealOn, focusedKey]);

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
  const level = (
    (currentItem as { cefr_level?: string }).cefr_level || activeLevel
  ).toUpperCase();
  const levelColor = levelColorFor(level);

  const expansionLoading = expanded && !contentLoaded;
  const translation = cardContent?.translation ?? null;
  const enrichment = cardContent?.enrichment ?? null;
  const lang = (targetLang || 'ES').toUpperCase();

  // Same source-of-truth swap as VocabRow: batch preview while hidden,
  // enrichment sentence once it has loaded. Idioms only get the enrichment.
  const preview = !idiom ? sentencePreviews[currentKey] : undefined;
  const collapsedSentence = preview && preview.sentence ? preview : null;
  const visibleSentence = contentLoaded && enrichment ? enrichment : collapsedSentence;
  const previewLoading = !idiom && preview === undefined;
  const sentenceTranslation = contentLoaded ? enrichment?.translation || null : null;

  const isSaved = savedWords.has(currentKey);

  // Sentence highlight: the target word is bold italic in the CEFR colour,
  // except B1's yellow which is too light on the white card.
  const highlightColorFor = (lvl: string, color: string) =>
    scheme === 'light' && lvl === 'B1' ? B1_HIGHLIGHT : color;

  /**
   * The full card anatomy in its hidden (dashed placeholders) state — the
   * face the outgoing fly-away overlay shows. Slot heights mirror the
   * focused card exactly so the detach is invisible.
   */
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
    const wTier = wordTier(term);
    const sTier = staticSentence ? sentenceTier(staticSentence.sentence) : null;
    return (
      <>
        <View style={s.metaRow}>
          <Text style={s.rank}>{rankNumber}</Text>
          <View style={[s.levelChip, { backgroundColor: `${lvlColor}22` }]}>
            <Text style={[s.levelChipText, { color: lvlColor }]}>{lvl}</Text>
          </View>
          {staticBadge ? (
            <View style={s.idiomBadge}>
              <Text style={s.idiomBadgeText}>{staticBadge}</Text>
            </View>
          ) : null}
          <View style={s.flexSpacer} />
          {isAuthenticated ? (
            <Text style={[s.star, savedWords.has(term) && s.starActive]}>
              {savedWords.has(term) ? '★' : '☆'}
            </Text>
          ) : null}
        </View>
        <View style={s.wordSlot}>
          <Text
            style={[s.word, { fontSize: wTier.fontSize, lineHeight: wTier.lineHeight }]}
            numberOfLines={wTier.lines}
          >
            {term}
          </Text>
        </View>
        <View style={s.wordTrSlot}>
          <View style={[s.slotLayer, s.wordTrRow]}>
            <View style={s.langTagDashed}>
              <Text style={s.langTagDashedText}>{lang}</Text>
            </View>
            <DashedRule color={dashColor} style={s.flexSpacer} />
          </View>
        </View>
        <View style={s.cardDivider} />
        <View style={s.sentenceSlot}>
          {staticSentence && sTier ? (
            renderHighlighted(
              staticSentence.sentence,
              term,
              staticSentence.matched_form,
              highlightColorFor(lvl, lvlColor),
              [s.sentence, { fontSize: sTier.fontSize, lineHeight: sTier.lineHeight }],
              s.sentenceHi,
              sTier.lines,
            )
          ) : !staticIdiom && staticPreview === undefined ? (
            <View style={s.skeletonPad}>
              <View style={[s.skelBar, { width: '92%' }]} />
              <View style={[s.skelBar, { width: '64%', marginTop: 7 }]} />
            </View>
          ) : (
            <Text style={s.noExamples}>No example in this script</Text>
          )}
        </View>
        <View style={s.sentenceTrSlot}>
          <View style={[s.slotLayer, s.sentenceTrHidden]}>
            <DashedLeftBorder color={`${tc.gold}59`} />
            <View style={s.sentenceTrHiddenRules}>
              <DashedRule color={dashColorSoft} style={{ width: '88%' }} />
              <DashedRule color={dashColorSoft} style={{ width: '62%' }} />
            </View>
          </View>
        </View>
        {/* Mirror the focused card's footer exactly: any element missing
            here would pop at the instant the overlay detaches. */}
        <View style={s.footerRow}>
          {isAuthenticated ? <Text style={s.actionText}>⚐ Report an issue</Text> : null}
          {isPremium && !staticIdiom ? (
            <Text style={[s.actionText, s.pronounceIcon]}>🔊</Text>
          ) : null}
          <Text style={s.tapHint}>TAP TO REVEAL</Text>
        </View>
      </>
    );
  };

  const wTier = wordTier(currentKey);
  const wtText =
    translation != null && translation.length > 0 ? translation.toLowerCase() : '—';
  const wtTier = wordTranslationTier(wtText);
  const sTier = visibleSentence ? sentenceTier(visibleSentence.sentence) : null;
  const stTier = sentenceTranslation ? sentenceTranslationTier(sentenceTranslation) : null;

  const gestureHint = onMarkLearned
    ? 'swipe left = know it · swipe right = next · tap card = translation'
    : 'swipe right = next · tap card = translation';

  return (
    <View style={s.wrap}>
      {resumedAt != null ? (
        <View style={s.resumeChip}>
          <Text style={s.resumeChipText}>⚑ Resumed at your bookmark · card {resumedAt}</Text>
        </View>
      ) : null}

      <View style={s.deckWrap}>
        {/* Ghost cards — pure styling; the incoming card's arrive animation
            starts from the near ghost's slot so the deck reads as stepping
            one card forward. */}
        {total > 2 ? (
          <View
            pointerEvents="none"
            style={[
              s.ghost,
              { top: GHOSTS[1].top, left: GHOSTS[1].inset, right: GHOSTS[1].inset, opacity: GHOSTS[1].opacity },
            ]}
          />
        ) : null}
        {total > 1 ? (
          <View
            pointerEvents="none"
            style={[
              s.ghost,
              { top: GHOSTS[0].top, left: GHOSTS[0].inset, right: GHOSTS[0].inset, opacity: GHOSTS[0].opacity },
            ]}
          />
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
          <Pressable
            style={s.cardPress}
            onPress={handleCardPress}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Hide translation' : 'Show translation'}
          >
            {/* 1 · meta row: rank · level chip · idiom badge · save star */}
            <View style={s.metaRow}>
              <Text style={s.rank}>{displayDeck.index + 1}</Text>
              <View style={[s.levelChip, { backgroundColor: `${levelColor}22` }]}>
                <Text style={[s.levelChipText, { color: levelColor }]}>{level}</Text>
              </View>
              {idiom ? (
                <View style={s.idiomBadge}>
                  <Text style={s.idiomBadgeText}>
                    {(currentItem as IdiomInfo).type === 'phrasal_verb' ? 'phrasal verb' : 'idiom'}
                  </Text>
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

            {/* 2 · word slot — bottom-aligned; long words step down a tier
                and wrap to two lines instead of shrinking */}
            <View style={s.wordSlot}>
              <Text
                style={[s.word, { fontSize: wTier.fontSize, lineHeight: wTier.lineHeight }]}
                numberOfLines={wTier.lines}
              >
                {currentKey}
              </Text>
            </View>

            {/* 3 · word-translation slot: two stacked layers cross-fade in
                place — dashed rule while hidden, translation when revealed */}
            <View style={s.wordTrSlot}>
              <Animated.View
                style={[s.slotLayer, s.wordTrRow, { opacity: revealHiddenOpacity }]}
              >
                <View style={s.langTagDashed}>
                  <Text style={s.langTagDashedText}>{lang}</Text>
                </View>
                {expansionLoading ? (
                  <View style={[s.skelBar, s.flexSpacer, { height: 10 }]} />
                ) : (
                  <DashedRule color={dashColor} style={s.flexSpacer} />
                )}
              </Animated.View>
              <Animated.View
                style={[
                  s.slotLayer,
                  s.wordTrRow,
                  { opacity: animRef.current.reveal, transform: [{ translateY: revealRise }] },
                ]}
              >
                <Text
                  style={[s.wordTranslation, { fontSize: wtTier.fontSize }]}
                  numberOfLines={1}
                >
                  {wtText}
                </Text>
                <View style={s.langTagSolid}>
                  <Text style={s.langTagSolidText}>{lang}</Text>
                </View>
              </Animated.View>
            </View>

            {/* 4 · divider */}
            <View style={s.cardDivider} />

            {/* 5 · sentence slot — highlighted target word; long sentences
                step down a tier and gain a 4th line */}
            <View style={s.sentenceSlot}>
              {visibleSentence && sTier ? (
                renderHighlighted(
                  visibleSentence.sentence,
                  currentKey,
                  visibleSentence.matched_form,
                  highlightColorFor(level, levelColor),
                  [s.sentence, { fontSize: sTier.fontSize, lineHeight: sTier.lineHeight }],
                  s.sentenceHi,
                  sTier.lines,
                )
              ) : previewLoading || (idiom && expansionLoading) ? (
                <View style={s.skeletonPad}>
                  <View style={[s.skelBar, { width: '92%' }]} />
                  <View style={[s.skelBar, { width: '64%', marginTop: 7 }]} />
                </View>
              ) : (
                <Text style={s.noExamples}>No example in this script</Text>
              )}
            </View>

            {/* 6 · sentence-translation slot — same in-place cross-fade;
                dashed gold bar + placeholder rules turn solid + filled */}
            <View style={s.sentenceTrSlot}>
              <Animated.View
                style={[s.slotLayer, s.sentenceTrHidden, { opacity: revealHiddenOpacity }]}
              >
                <DashedLeftBorder color={`${tc.gold}59`} />
                <View style={s.sentenceTrHiddenRules}>
                  <DashedRule color={dashColorSoft} style={{ width: '88%' }} />
                  <DashedRule color={dashColorSoft} style={{ width: '62%' }} />
                </View>
              </Animated.View>
              <Animated.View
                style={[
                  s.slotLayer,
                  s.sentenceTrRevealed,
                  { opacity: animRef.current.reveal, transform: [{ translateY: revealRise }] },
                ]}
              >
                {sentenceTranslation && stTier ? (
                  <Text
                    style={[
                      s.sentenceTranslation,
                      { fontSize: stTier.fontSize, lineHeight: stTier.lineHeight },
                    ]}
                    numberOfLines={stTier.lines}
                  >
                    {sentenceTranslation}
                  </Text>
                ) : (
                  <Text style={s.noExamples}>No translation available</Text>
                )}
              </Animated.View>
            </View>

            {/* 7 · footer: report + pronounce + reveal-state hint */}
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
              <Text style={s.tapHint}>{expanded ? 'TAP TO HIDE' : 'TAP TO REVEAL'}</Text>
            </View>
          </Pressable>
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

      {/* actions under the deck — labeled tactile buttons with press-down
          physics (edge layer + face drop); they fully cover the gestures */}
      <View style={s.actionsRow}>
        {onMarkLearned ? (
          <Pressable
            onPress={() => doLearn('button')}
            accessibilityRole="button"
            accessibilityLabel="I know this word"
          >
            {({ pressed }) => (
              <View style={s.pillWrap}>
                <View style={[s.pillEdge, s.knowEdge]} />
                <View
                  style={[s.pillFace, s.knowFace, pressed && s.pillFacePressed]}
                >
                  <Text style={s.knowCheck}>✓</Text>
                  <Text style={s.knowLabel}>Know it</Text>
                </View>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={s.pillWrap} />
        )}

        <Pressable
          onPress={doUndo}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel="Bring back the previous card"
        >
          {({ pressed }) => (
            <View style={[s.undoWrap, !canUndo && s.undoDisabled]}>
              <View style={s.undoEdge} />
              <View style={[s.undoFace, pressed && canUndo && s.undoFacePressed]}>
                <Ionicons name="arrow-undo" size={18} color={tc.textSecondary} />
              </View>
            </View>
          )}
        </Pressable>

        <Pressable
          onPress={() => doAdvance('button')}
          accessibilityRole="button"
          accessibilityLabel="Next card"
        >
          {({ pressed }) => (
            <View style={s.pillWrap}>
              <View style={[s.pillEdge, s.nextEdge]} />
              <LinearGradient
                colors={scheme === 'dark' ? ['#FFD166', '#E4B44A'] : ['#D89B22', '#C58B1B']}
                style={[s.pillFace, s.nextFace, pressed && s.pillFacePressed]}
              >
                <Text style={s.nextLabel}>Next</Text>
                <Text style={s.nextArrow}>→</Text>
              </LinearGradient>
            </View>
          )}
        </Pressable>
      </View>

      <Text style={s.gestureHint}>{gestureHint}</Text>

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

const makeDeckStyles = (tc: ThemeColors, scheme: 'light' | 'dark') => {
  const light = scheme === 'light';
  return StyleSheet.create({
    wrap: {
      paddingTop: 4,
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
      marginBottom: 10,
    },
    resumeChipText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.2,
      color: tc.goldOnSurface,
    },
    deckWrap: {
      marginHorizontal: 18,
      marginTop: 0,
      height: DECK_ZONE_HEIGHT,
    },
    ghost: {
      position: 'absolute',
      height: CARD_HEIGHT,
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
    },
    // A swiped card mid-flight: same face as the focused card, floating
    // above the new focused card.
    outgoingCard: {
      position: 'absolute',
      top: STACK_HEADROOM,
      left: 0,
      right: 0,
      height: CARD_HEIGHT,
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
      padding: 20,
      overflow: 'hidden',
      shadowColor: light ? '#2D2418' : '#000',
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    card: {
      position: 'absolute',
      top: STACK_HEADROOM,
      left: 0,
      right: 0,
      height: CARD_HEIGHT,
      backgroundColor: tc.paper,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: tc.border,
      shadowColor: light ? '#2D2418' : '#000',
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    cardPress: {
      flex: 1,
      padding: 20,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: META_ROW_HEIGHT,
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
    idiomBadge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 5,
      backgroundColor: `${tc.gold}1A`,
    },
    idiomBadgeText: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
      color: tc.goldOnSurface,
    },
    flexSpacer: {
      flex: 1,
    },
    star: {
      fontSize: 22,
      lineHeight: 24,
      color: light ? '#C9BB9C' : tc.textFaint,
    },
    starActive: {
      color: tc.gold,
    },
    wordSlot: {
      marginTop: WORD_SLOT_TOP,
      height: WORD_SLOT_HEIGHT,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    word: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      letterSpacing: -0.3,
      color: tc.text,
    },
    wordTrSlot: {
      marginTop: WORD_TR_SLOT_TOP,
      height: WORD_TR_SLOT_HEIGHT,
    },
    slotLayer: {
      ...StyleSheet.absoluteFillObject,
    },
    wordTrRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    wordTranslation: {
      fontFamily: SERIF_FAMILY,
      fontStyle: 'italic',
      fontWeight: '600',
      color: tc.primaryOnSurface,
      flexShrink: 1,
    },
    langTagDashed: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: light ? '#D9CFB4' : 'rgba(255,255,255,0.18)',
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    langTagDashedText: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.7,
      color: tc.textFaint,
    },
    langTagSolid: {
      backgroundColor: tc.divider,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    langTagSolidText: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.7,
      color: tc.textSecondary,
    },
    cardDivider: {
      marginTop: DIVIDER_TOP,
      height: DIVIDER_HEIGHT,
      backgroundColor: tc.divider,
    },
    sentenceSlot: {
      marginTop: SENTENCE_SLOT_TOP,
      height: SENTENCE_SLOT_HEIGHT,
      overflow: 'hidden',
    },
    sentence: {
      fontFamily: SERIF_FAMILY,
      color: light ? '#54462F' : tc.textSecondary,
    },
    sentenceHi: {
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      fontStyle: 'italic',
    },
    // Vertically settles the skeleton bars on the first text line of the
    // zone they stand in for.
    skeletonPad: {
      paddingTop: 6,
    },
    skelBar: {
      height: 13,
      borderRadius: 4,
      backgroundColor: tc.skeleton,
    },
    sentenceTrSlot: {
      marginTop: SENTENCE_TR_SLOT_TOP,
      height: SENTENCE_TR_SLOT_HEIGHT,
    },
    sentenceTrHidden: {
      justifyContent: 'center',
    },
    sentenceTrHiddenRules: {
      paddingLeft: 12,
      gap: 12,
    },
    sentenceTrRevealed: {
      borderLeftWidth: 2,
      borderLeftColor: tc.gold,
      paddingLeft: 12,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    sentenceTranslation: {
      fontFamily: SERIF_FAMILY,
      fontStyle: 'italic',
      color: light ? '#5C4F38' : tc.textSecondary,
    },
    noExamples: {
      fontFamily: SERIF_FAMILY,
      fontSize: 14,
      fontStyle: 'italic',
      color: tc.textFaint,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      marginTop: FOOTER_TOP,
      height: FOOTER_HEIGHT,
    },
    actionText: {
      fontSize: 11,
      fontWeight: '600',
      color: tc.textFaint,
    },
    pronounceIcon: {
      fontSize: 13,
    },
    pronounceActive: {
      opacity: 0.5,
    },
    tapHint: {
      marginLeft: 'auto',
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.9,
      color: light ? '#C0A66B' : 'rgba(255,209,102,0.55)',
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      marginHorizontal: 18,
    },
    // Edge + face "3D" button: the face translates down onto its edge while
    // pressed — same pattern as the practice tiles.
    pillWrap: {
      width: PILL_WIDTH,
      height: PILL_HEIGHT + PILL_EDGE,
    },
    pillEdge: {
      position: 'absolute',
      top: PILL_EDGE,
      left: 0,
      right: 0,
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
    },
    pillFace: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
    },
    pillFacePressed: {
      transform: [{ translateY: PILL_EDGE_PRESSED_DROP }],
    },
    knowEdge: {
      backgroundColor: 'rgba(63,139,123,0.28)',
    },
    knowFace: {
      backgroundColor: tc.paper,
      borderWidth: 1.5,
      borderColor: tc.success,
    },
    knowCheck: {
      color: tc.success,
      fontSize: 15,
      fontWeight: '800',
    },
    knowLabel: {
      color: tc.success,
      fontSize: 13.5,
      fontWeight: '800',
    },
    nextEdge: {
      backgroundColor: tc.nodeGoldEdge,
    },
    nextFace: {
      gap: 8,
    },
    nextLabel: {
      color: tc.goldDeep,
      fontSize: 13.5,
      fontWeight: '900',
    },
    nextArrow: {
      color: tc.goldDeep,
      fontSize: 15,
      fontWeight: '800',
    },
    undoWrap: {
      width: UNDO_SIZE,
      height: UNDO_SIZE + UNDO_EDGE,
    },
    undoEdge: {
      position: 'absolute',
      top: UNDO_EDGE,
      left: 0,
      width: UNDO_SIZE,
      height: UNDO_SIZE,
      borderRadius: UNDO_SIZE / 2,
      backgroundColor: light ? 'rgba(45,36,24,0.08)' : 'rgba(0,0,0,0.4)',
    },
    undoFace: {
      width: UNDO_SIZE,
      height: UNDO_SIZE,
      borderRadius: UNDO_SIZE / 2,
      backgroundColor: tc.paper,
      borderWidth: 1.5,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    undoFacePressed: {
      transform: [{ translateY: UNDO_EDGE - 1 }],
    },
    undoDisabled: {
      opacity: 0.35,
    },
    gestureHint: {
      marginTop: 10,
      textAlign: 'center',
      fontSize: 10.5,
      color: light ? '#A79878' : tc.textFaint,
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
};

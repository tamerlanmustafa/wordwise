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
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, withAlpha } from '../../theme/tokens';
import { SERIF_FAMILY, SERIF_ITALIC_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import type { ThemeColors } from '../../theme/tokens';
import {
  wordwiseApi,
  authFetch,
  API_BASE_URL,
  type WordInfo,
  type IdiomInfo,
} from '../../services/api';
import { useIsPremium } from '../../stores/entitlementsStore';
import { showToast } from '../../stores/toastStore';
import { pronounce } from '../../utils/pronunciation';
import { withTap } from '../../utils/feedback';
import { ReportDialog } from '../ReportDialog';
import { track } from '../../services/analytics';
import { renderHighlighted, type SentenceExample } from './VocabRow';
import { wordTranslationDisplay } from './translationDisplay';
import { glossLine } from '../../utils/glossLine';
import { directionalIcon, directionSign } from '../../i18n/rtl';
import {
  deckReducer,
  restoreDeck,
  swipeDecision,
  shouldClaimHorizontalDrag,
  promotedKeyAfterRemoval,
  warmWindowKeys,
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
  DEFINITION_SLOT_TOP,
  DEFINITION_SLOT_HEIGHT,
  WORD_TR_SLOT_TOP,
  WORD_TR_SLOT_HEIGHT,
  SENTENCE_LABEL_TOP,
  SENTENCE_LABEL_HEIGHT,
  SENTENCE_SLOT_TOP,
  SENTENCE_SLOT_HEIGHT,
  SENTENCE_TR_SLOT_TOP,
  SENTENCE_TR_SLOT_HEIGHT,
  FOOTER_TOP,
  FOOTER_HEIGHT,
  DECK_SPEAKER_CHIP,
  DECK_SPEAKER_GAP,
  REVEAL_IN_MS,
  REVEAL_OUT_MS,
  REVEAL_RISE_PX,
  wordTier,
  wordTranslationTier,
  definitionTier,
  sentenceTier,
  sentenceTranslationTier,
} from './cardLayout';
import {
  deckMetrics,
  ACTIONS_ROW_HEIGHT,
  ACTIONS_GAP,
  DECK_GAP_TOP,
  PILL_WIDTH,
  PILL_HEIGHT,
  PILL_EDGE,
  PILL_EDGE_PRESSED_DROP,
  UNDO_SIZE,
  UNDO_EDGE,
} from './deckMetrics';
import { FlagIcon, HeartIcon } from '../ui/icons';
import { SpeakerChip } from '../ui/SpeakerChip';

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
  /** Logical fly direction: +1 toward the trailing edge (next), -1 toward the
   *  leading edge (learned). Converted to physical pixels below. */
  dir: 1 | -1;
  /** Logical drag offset at release — the overlay picks up exactly where the
   *  finger let go. */
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
  // Physical direction of travel — the logical one mirrored under RTL, so the
  // card flies out the same edge the finger pushed it toward.
  const physicalDir = dir * directionSign;
  const transform = [
    {
      translateX: progress.interpolate({
        inputRange: [0, 1],
        outputRange: [startX * directionSign, physicalDir * FLY_DISTANCE],
      }),
    },
    { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, FLY_DROP] }) },
    {
      rotate: progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', `${physicalDir * FLY_ROTATE_DEG}deg`],
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

/**
 * Same clip trick for the sentence-translation slot's dashed leading border.
 * Both offsets are logical (`start`), so the dashed placeholder lands on the
 * same edge as the solid `borderStartWidth` it cross-fades into — under RTL
 * `left` would have put them on opposite sides of the card.
 */
const DashedStartBorder = ({ color, width = 2 }: { color: string; width?: number }) => (
  <View
    pointerEvents="none"
    style={{ position: 'absolute', top: 0, bottom: 0, start: 0, width, overflow: 'hidden' }}
  >
    <View
      style={{
        position: 'absolute',
        top: -width,
        bottom: -width,
        start: 0,
        width: width * 4,
        borderWidth: width,
        borderColor: color,
        borderStyle: 'dashed',
      }}
    />
  </View>
);

/**
 * `EXAMPLE SENTENCE` eyebrow: a hairline with a name on it, not a heading —
 * quiet on purpose, so it never competes with the sentence beneath it. The
 * rule is `flex: 1` after a `gap`, so RTL mirrors it with no offset of ours.
 */
const SentenceLabel = ({
  s,
  label,
}: {
  s: ReturnType<typeof makeDeckStyles>;
  label: string;
}) => (
  <View style={s.sentenceLabelRow}>
    <Text style={s.sentenceLabelText} numberOfLines={1}>
      {label}
    </Text>
    <View style={s.sentenceLabelRule} />
  </View>
);

/**
 * The English learner gloss under the headword — "(noun) a person who…".
 *
 * Shared by the focused card and the fly-away overlay's static body — the two
 * must render byte-identical slots or the card visibly pops at the instant the
 * overlay detaches, which is exactly the class of bug the static body exists to
 * avoid. Hence one component rather than two copies of the same four lines.
 *
 * The View renders whether or not there is anything to put in it: the slot is
 * part of the card's constant height (see cardLayout), so it is reserved for a
 * lemma the definition worker hasn't reached yet and simply left blank. No
 * dashed placeholder — on this card dashes mean "this fills in when you tap",
 * and this line does not.
 *
 * Both halves are independently optional, so `glossLine` composes them: a word
 * whose part of speech the parser never tagged still shows its definition, and
 * a word the definition worker hasn't reached still shows its type.
 */
const DefinitionSlot = ({
  s,
  definition,
  pos,
}: {
  s: ReturnType<typeof makeDeckStyles>;
  definition?: string | null;
  pos?: string | null;
}) => {
  const gloss = glossLine(pos, definition);
  // Tiered on the composed line, label included — see definitionTier.
  const tier = gloss ? definitionTier(gloss.text) : null;
  return (
    <View style={s.definitionSlot}>
      {gloss && tier ? (
        <Text
          style={[s.definition, { fontSize: tier.fontSize, lineHeight: tier.lineHeight }]}
          numberOfLines={tier.lines}
        >
          {gloss.pos ? <Text style={s.definitionPos}>{gloss.pos}</Text> : null}
          {gloss.pos && gloss.definition ? ' ' : null}
          {gloss.definition}
        </Text>
      ) : null}
    </View>
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
const FLY_DISTANCE = 430;
const FLY_DROP = 8;
const FLY_ROTATE_DEG = 7;
/** Incoming card settling from the ghost slot to the front. */
const ARRIVE_DURATION = 250;
const DRAG_CLAMP = 160;
const UNDO_STACK_MAX = 20;
/**
 * How long a card must hold focus before the deck warms it and the one behind
 * it. Every focus change re-arms the timer, so flicking through twenty cards
 * costs nothing — only a card the reader actually stopped on is fetched.
 */
const WARM_SETTLE_MS = 600;

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
  const { t } = useTranslation();
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

  // The screen does not scroll, so the deck block takes whatever the fixed
  // column leaves it and the deck zone scales to fit. Measured rather than
  // computed, so `available` accounts for the safe-area insets and every block
  // above — and for the bottom bar, but only because the parent pads by
  // `useBottomBarInset()`. Measurement cannot see an absolute overlay; the
  // deck used to measure straight through the floating capsule and lay its
  // action pills out underneath it. Hooks run before the empty-deck
  // return below, so this is computed unconditionally.
  const [available, setAvailable] = useState(0);
  const metrics = useMemo(() => deckMetrics({ available }), [available]);

  // Keep the committed state in step with the parent's item list (learned
  // words leaving, undo re-adding, previews resolving). `displayDeck` applies
  // the same pure sync during render so the frame the list shrinks never
  // shows a stale card while the effect commits.
  useEffect(() => {
    if (!restoredRef.current) {
      if (keys.length === 0) return;
      restoredRef.current = true;
      dispatch({ type: 'restore', keys, bookmarkWord: initialWord ?? null });
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

  // Where the reader resumed is marked on the header's progress rule, not by a
  // note floating over the deck: a 3.2s chip that timed itself out could only
  // be read by someone already looking at it, and the mark stays legible for
  // the whole session at no cost to the card's budget (see MovieDetailScreen's
  // `resumeMarkPct` and deckLogic.resumeMarkerPercent).

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
    /** Logical drag offset: positive = toward the trailing edge. */
    translate: Animated.Value;
    /** …the same value in physical pixels, built once per key so a re-render
     *  mid-drag rebinds the same native node rather than a fresh one. */
    translateX: Animated.AnimatedMultiplication<number>;
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
                // An undone card left toward the trailing edge, so it comes
                // back from there — physically the right in LTR, the left
                // under RTL.
                translateX: arrive.interpolate({
                  inputRange: [0, 1],
                  outputRange: [FLY_DISTANCE * directionSign, 0],
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
                  outputRange: [`${FLY_ROTATE_DEG * directionSign}deg`, '0deg'],
                }),
              },
            ],
          }
        : liftStyle(arrive, STACK_SLOTS[mode === 'step' ? 1 : 0], STACK_SLOTS[0]);
    const translate = new Animated.Value(0);
    animRef.current = {
      key: focusedKey,
      translate,
      translateX: Animated.multiply(translate, directionSign),
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
  const {
    translate,
    translateX,
    focusOpacity,
    focusedArrive,
    focusedOpacity,
    revealHiddenOpacity,
    revealRise,
  } = animRef.current;

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
    { id: number; dir: 1 | -1; startX: number; item: DeckItem }[]
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

  // Read from inside timers and callbacks without making the cache a
  // dependency that would re-arm the warm timer on every fetch that lands.
  const contentRef = useRef(content);
  contentRef.current = content;
  /** Terms with a request already out. The tap, the warm window and a
   *  double-tap all funnel through loadContent, and only one may fire. */
  const inFlightRef = useRef<Set<string>>(new Set());
  /** Cards the reader has actually tapped. A warmed card holds its batch
   *  preview sentence until then, so warming stays invisible: the text on a
   *  card sitting still never changes under the reader, and the fly-away
   *  overlay (which renders from the previews alone) still matches it. */
  const revealedRef = useRef<Set<string>>(new Set());

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
      },
    ]);
  };

  const doAdvance = (method: 'swipe' | 'button') => {
    if (displayDeck.index < 0 || total === 0 || currentKey == null) return;
    if (total === 1) {
      // Only card in rotation: nothing to advance to — settle back.
      Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      return;
    }
    track('deck_advance', { method });
    const nextKey = displayDeck.keys[(displayDeck.index + 1) % total];
    pushOutgoing(1, method === 'swipe' ? lastDragXRef.current : 0);
    undoStackRef.current.push(currentKey);
    if (undoStackRef.current.length > UNDO_STACK_MAX) undoStackRef.current.shift();
    nextMountAnimRef.current = 'step';
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
        // Logical offset in, physical pixels out (the `translateX` node above)
        // — `dx` never mirrors, so a raw read would send an Arabic card the
        // wrong way and commit the opposite action.
        const x = Math.max(-DRAG_CLAMP, Math.min(g.dx * directionSign, DRAG_CLAMP));
        lastDragXRef.current = x;
        animRef.current?.translate.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        onDragStateChangeRef.current?.(false);
        // `vx` is physical for the same reason `dx` is — it mirrors nowhere —
        // so it converts on the way in too, or a flick would commit the
        // opposite action to the drag it ended.
        const action = swipeDecision(g.dx * directionSign, g.vx * directionSign);
        if (action === 'next') {
          doAdvanceRef.current('swipe');
          return;
        }
        if (action === 'learn' && canLearnRef.current) {
          doLearnRef.current('swipe');
          return;
        }
        if (animRef.current) {
          Animated.spring(animRef.current.translate, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        onDragStateChangeRef.current?.(false);
        if (animRef.current) {
          Animated.spring(animRef.current.translate, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  /**
   * Fetch a card's reveal payload into the per-word cache — BOTH translations
   * together, so the tap can cross-fade them in one motion. The sentence
   * endpoint returns the sentence, its translation, AND the word gloss aligned
   * to that translation (word_translation), so the gloss matches the sentence
   * and, once cached server-side, the reveal costs nothing to repeat. We only
   * fall back to a standalone translate() call when no aligned gloss is
   * available (idioms, words with no example, or alignment unavailable).
   *
   * Safe to call for a card nobody has tapped: it is the exact request the tap
   * would have made, so warming a card the reader goes on to reveal is free,
   * and warming one they swipe past costs what revealing it would have.
   * Idempotent — a card already cached or already in flight is a no-op.
   *
   * `warm` marks a speculative call. It changes exactly one thing: a warm fetch
   * that comes back with NOTHING (offline, dropped request) leaves the cache
   * empty so the reader's eventual tap retries, where a tap's own failure is
   * cached and shown as "Translation failed". Without that split, one dead
   * request would poison a card the reader has not even reached yet.
   */
  const loadContent = (term: string, item: DeckItem, warm = false) => {
    if (contentRef.current[term] || inFlightRef.current.has(term)) return;
    inFlightRef.current.add(term);

    const isIdiom = isIdiomItem(item);
    // Context for the fallback translate(): the example sentence shown on the
    // card, so even the fallback biases toward the in-sentence sense.
    const contextSentence = !isIdiom
      ? sentencePreviews[term]?.sentence || undefined
      : undefined;

    (async () => {
      try {
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
        let failed = false;
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
            failed = true;
          }
        }

        if (warm && failed && enrichment == null) return;
        setContent((prev) => ({ ...prev, [term]: { translation, enrichment, loaded: true } }));
      } finally {
        // Failure clears the flag too, so the next tap can retry rather than
        // leaving the card permanently stuck on its dashed placeholders.
        inFlightRef.current.delete(term);
      }
    })();
  };
  const loadContentRef = useRef(loadContent);
  loadContentRef.current = loadContent;

  // Tap → reveal in place. Usually the fetch already finished (the warm window
  // below), so the cross-fade runs on the same frame as the tap.
  const handleCardPress = () => {
    if (currentKey == null || currentItem == null) return;
    const term = currentKey;
    if (expandedKey === term) {
      setExpandedKey(null);
      return;
    }
    revealedRef.current.add(term);
    setExpandedKey(term);
    if (isAuthenticated) {
      wordwiseApi.logInteraction(term, 'ROW_CLICK', movieId);
    }
    loadContent(term, currentItem);
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

  // ── Warm window: the focused card + the one behind it ────────────────────
  // Explore feels instant because /srs/feed batch-translates a whole page and
  // ships the translations inside the page, so a tap there costs no network.
  // The deck can't batch that way — each card is its own movie-scoped
  // enrichment call — so it moves the work earlier instead: by the time a
  // thumb lands, the request is already done.
  //
  // Warming TWO cards rather than one is what bounds the cost. After the first
  // advance the incoming card is always already warm, so steady state is ONE
  // request per advance — the same request the tap used to make, just earlier.
  // The ceiling for a reader who swipes past everything without revealing is
  // therefore the same as for one who reveals every card.
  const warmKeys = warmWindowKeys(displayDeck);
  const warmKeysRef = useRef(warmKeys);
  warmKeysRef.current = warmKeys;
  const itemByKeyRef = useRef(itemByKey);
  itemByKeyRef.current = itemByKey;
  // Depend on the window's contents, not the array's identity: the parent
  // rebuilds `items` every time a batch of sentence previews resolves, and
  // re-arming this timer on each of those would push the fetch out behind them.
  const [warmFocus = '', warmNext = ''] = warmKeys;
  useEffect(() => {
    if (!warmFocus) return;
    const id = setTimeout(() => {
      for (const key of warmKeysRef.current) {
        const item = itemByKeyRef.current.get(key);
        if (item) loadContentRef.current(key, item, true);
      }
    }, WARM_SETTLE_MS);
    return () => clearTimeout(id);
  }, [warmFocus, warmNext]);

  const handlePronounce = async () => {
    if (playingAudio || currentKey == null) return;
    setPlayingAudio(true);
    // `pronounce` never rejects and always settles, so the icon always comes
    // back — including on the 401 that made this button silent for months.
    const result = await pronounce(currentKey);
    setPlayingAudio(false);
    if (result === 'failed') showToast({ tone: 'error', message: t('vocabulary:pronounceFailed') });
    // A tap that does nothing is the bug this ticket fixed; "off in Settings"
    // is still nothing happening unless we say so.
    else if (result === 'muted') showToast({ message: t('vocabulary:pronounceMuted') });
  };

  if (total === 0 || currentItem == null || currentKey == null) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyText}>{t('vocabulary:deck.empty')}</Text>
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
  //
  // The swap waits for the reader's first tap, not merely for the fetch: since
  // the warm window loads cards nobody has touched, keying it off contentLoaded
  // alone would let a card's sentence change while it sits still on screen —
  // and would desync it from the fly-away overlay, which renders from the batch
  // previews. Both endpoints rank SentenceBank with the same key, so this is a
  // guard against them ever drifting, not a papered-over difference.
  const preview = !idiom ? sentencePreviews[currentKey] : undefined;
  const collapsedSentence = preview && preview.sentence ? preview : null;
  const revealedOnce = revealedRef.current.has(currentKey);
  const visibleSentence =
    contentLoaded && enrichment && revealedOnce ? enrichment : collapsedSentence;
  const previewLoading = !idiom && preview === undefined;
  const sentenceTranslation = contentLoaded ? enrichment?.translation || null : null;

  const isSaved = savedWords.has(currentKey);

  // Sentence highlight: the target word is bold italic in the band's own
  // colour, with no exceptions any more.
  //
  // There used to be one, for B1. The old band palette put a bright amber
  // (#FFC107) at B1, which measured 1.63:1 on the light card — invisible — so
  // that one level was swapped for a darker gold and the highlight stopped
  // matching the chip above it. The shared ramp has no such hole: on the light
  // card the six bands measure 2.96–3.43:1, and on the dark card 6.4–13.2:1.
  // Special-casing a level now would be the only thing breaking the promise
  // that a band is one colour everywhere.
  const highlightColorFor = (_lvl: string, color: string) => color;

  /**
   * The full card anatomy in its hidden (dashed placeholders) state — the
   * face the outgoing fly-away overlay shows. Slot heights mirror the
   * focused card exactly so the detach is invisible.
   */
  const renderStaticBody = (item: DeckItem) => {
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
            <HeartIcon size={21} filled={savedWords.has(term)} color={savedWords.has(term) ? tc.gold : tc.textFaint} />
          ) : null}
        </View>
        <View style={s.wordSlot}>
          <View style={s.wordRow}>
            <Text
              style={[s.word, { fontSize: wTier.fontSize, lineHeight: wTier.lineHeight }]}
              numberOfLines={wTier.lines}
            >
              {term}
            </Text>
            {isPremium && !staticIdiom ? (
              // Pointer-inert like the rest of this face, but it has to
              // measure identically or the word jumps as the overlay detaches.
              <SpeakerChip
                size={DECK_SPEAKER_CHIP}
                playing={false}
                disabled
                accessibilityLabel={t('vocabulary:row.pronounce')}
                style={s.wordSpeaker}
              />
            ) : null}
          </View>
        </View>
        <DefinitionSlot
          s={s}
          definition={staticSentence?.definition}
          pos={staticSentence?.pos}
        />
        <View style={s.wordTrSlot}>
          <View style={[s.slotLayer, s.wordTrRow]}>
            <DashedRule color={dashColor} style={s.flexSpacer} />
            <View style={s.langTagDashed}>
              <Text style={s.langTagDashedText}>{lang}</Text>
            </View>
          </View>
        </View>
        <SentenceLabel s={s} label={t('movies:detail.exampleSentenceLabel')} />
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
            <Text style={s.noExamples}>{t('vocabulary:deck.noExample')}</Text>
          )}
        </View>
        <View style={s.sentenceTrSlot}>
          <View style={[s.slotLayer, s.sentenceTrHidden]}>
            <DashedStartBorder color={`${tc.gold}59`} />
            <View style={s.sentenceTrHiddenRules}>
              <DashedRule color={dashColorSoft} style={{ width: '88%' }} />
              <DashedRule color={dashColorSoft} style={{ width: '62%' }} />
            </View>
          </View>
        </View>
        {/* Mirror the focused card's footer exactly: any element missing
            here would pop at the instant the overlay detaches. */}
        <View style={s.footerRow}>
          {isAuthenticated ? (
            <View style={s.actionRow}>
              <FlagIcon size={13} color={tc.textFaint} />
              <Text style={s.actionText}>{t('vocabulary:row.reportIssue')}</Text>
            </View>
          ) : null}
          <Text style={s.tapHint}>{t('vocabulary:deck.tapToReveal')}</Text>
        </View>
      </>
    );
  };

  const wTier = wordTier(currentKey);
  // A provider that hands the word straight back ("khat" → "khat" in Turkish)
  // is usually right — plenty of loanwords are identical — but echoing it into
  // the translation slot reads as a broken card. Say it in words instead.
  const wtDisplay = wordTranslationDisplay(currentKey, translation);
  const wtSameAsSource = wtDisplay.kind === 'sameAsSource';
  const wtText =
    wtDisplay.kind === 'translation'
      ? wtDisplay.text
      : wtSameAsSource
        ? t('vocabulary:deck.sameAsSource')
        : '—';
  const wtTier = wordTranslationTier(wtText);
  const sTier = visibleSentence ? sentenceTier(visibleSentence.sentence) : null;
  const stTier = sentenceTranslation ? sentenceTranslationTier(sentenceTranslation) : null;

  return (
    <View style={s.wrap} onLayout={(e) => setAvailable(e.nativeEvent.layout.height)}>
      {/* The zone's LAID-OUT height shrinks (`zoneHeight`) while its contents
          keep their design geometry and are scaled about the top edge. A
          transform alone would not free the space below, and editing the
          card's slot constants would make it a different card. */}
      <View style={{ height: metrics.zoneHeight, overflow: 'hidden' }}>
      {/* `top center`, not the default centre: the zone's box is only
          `zoneHeight` tall while its contents keep the full 407, so scaling
          about the middle would push the card down out of its own box. */}
      <View
        style={[s.deckWrap, { transform: [{ scale: metrics.scale }], transformOrigin: 'top center' }]}
      >
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
            onPress={withTap(handleCardPress)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? t('vocabulary:deck.hideTranslation') : t('vocabulary:deck.showTranslation')}
          >
            {/* 1 · meta row: level chip · idiom badge · save star. The card's
                position in the deck is the progress bar's job, so it is not
                also printed here. */}
            <View style={s.metaRow}>
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
                  onPress={withTap((e: GestureResponderEvent) => {
                    e.stopPropagation();
                    onSave(currentKey);
                  })}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={isSaved ? t('vocabulary:row.removeFromSaved') : t('vocabulary:row.saveWord')}
                >
                  <HeartIcon size={21} filled={isSaved} color={isSaved ? tc.gold : tc.textFaint} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* 2 · word slot — bottom-aligned; long words step down a tier
                and wrap to two lines instead of shrinking */}
            <View style={s.wordSlot}>
              <View style={s.wordRow}>
                <Text
                  style={[s.word, { fontSize: wTier.fontSize, lineHeight: wTier.lineHeight }]}
                  numberOfLines={wTier.lines}
                >
                  {currentKey}
                </Text>
                {isPremium && !idiom ? (
                  <SpeakerChip
                    size={DECK_SPEAKER_CHIP}
                    playing={playingAudio}
                    onPress={withTap((e: GestureResponderEvent) => {
                      // The whole card is the reveal target; without this a
                      // tap on the speaker would also flip the translation.
                      e.stopPropagation();
                      handlePronounce();
                    })}
                    accessibilityLabel={t('vocabulary:row.pronounce')}
                    style={s.wordSpeaker}
                  />
                ) : null}
              </View>
            </View>

            {/* 2b · definition slot — English gloss for the sense the example
                sentence below uses. Not part of the reveal: it is the same
                language as the sentence, so it belongs to the always-visible
                half of the card. */}
            <DefinitionSlot
              s={s}
              definition={visibleSentence?.definition}
              pos={visibleSentence?.pos}
            />

            {/* 3 · word-translation slot: two stacked layers cross-fade in
                place — dashed rule while hidden, translation when revealed */}
            <View style={s.wordTrSlot}>
              <Animated.View
                style={[s.slotLayer, s.wordTrRow, { opacity: revealHiddenOpacity }]}
              >
                {expansionLoading ? (
                  <View style={[s.skelBar, s.flexSpacer, { height: 10 }]} />
                ) : (
                  <DashedRule color={dashColor} style={s.flexSpacer} />
                )}
                {/* Trailing, so it is in the same place as the solid tag on
                    the layer that cross-fades in over this one. These two
                    layers are stacked absolutely and only their opacity
                    differs, so anything that moves between them reads as the
                    tag sliding across the card during the reveal. */}
                <View style={s.langTagDashed}>
                  <Text style={s.langTagDashedText}>{lang}</Text>
                </View>
              </Animated.View>
              <Animated.View
                style={[
                  s.slotLayer,
                  s.wordTrRow,
                  { opacity: animRef.current.reveal, transform: [{ translateY: revealRise }] },
                ]}
              >
                <Text
                  style={[
                    s.wordTranslation,
                    // The band's colour, the same one the chip above wears and
                    // the same one the target word is highlighted in below.
                    // Three marks on one card that all mean "this word is
                    // C1" — in three colours they read as three unrelated
                    // decorations, and the level stops being a fact the card
                    // states and becomes a badge in a corner.
                    //
                    // After the base style, so it overrides the token there;
                    // before the same-as-source override, which deliberately
                    // wins (see that style).
                    { color: levelColor },
                    wtSameAsSource && s.wordTranslationSameAsSource,
                    { fontSize: wtTier.fontSize },
                  ]}
                  numberOfLines={1}
                >
                  {wtText}
                </Text>
                <View style={s.langTagSolid}>
                  <Text style={s.langTagSolidText}>{lang}</Text>
                </View>
              </Animated.View>
            </View>

            {/* 4 · EXAMPLE SENTENCE eyebrow + hairline */}
            <SentenceLabel s={s} label={t('movies:detail.exampleSentenceLabel')} />

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
                <Text style={s.noExamples}>{t('vocabulary:deck.noExample')}</Text>
              )}
            </View>

            {/* 6 · sentence-translation slot — same in-place cross-fade;
                dashed gold bar + placeholder rules turn solid + filled */}
            <View style={s.sentenceTrSlot}>
              <Animated.View
                style={[s.slotLayer, s.sentenceTrHidden, { opacity: revealHiddenOpacity }]}
              >
                <DashedStartBorder color={`${tc.gold}59`} />
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
                  <Text style={s.noExamples}>{t('vocabulary:deck.noTranslation')}</Text>
                )}
              </Animated.View>
            </View>

            {/* 7 · footer: report + pronounce + reveal-state hint */}
            <View style={s.footerRow}>
              {isAuthenticated ? (
                <TouchableOpacity
                  style={s.actionRow}
                  onPress={withTap(() => setReportOpen(true))}
                  accessibilityRole="button"
                >
                  <FlagIcon size={13} color={tc.textFaint} />
                  <Text style={s.actionText}>{t('vocabulary:row.reportIssue')}</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={s.tapHint}>{expanded ? t('vocabulary:deck.tapToHide') : t('vocabulary:deck.tapToReveal')}</Text>
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
            {renderStaticBody(o.item)}
          </OutgoingCard>
        ))}
      </View>
      </View>

      {/* actions under the deck — labeled tactile buttons with press-down
          physics (edge layer + face drop); they fully cover the gestures */}
      <View style={s.actionsRow}>
        {onMarkLearned ? (
          <Pressable
            onPress={withTap(() => doLearn('button'))}
            accessibilityRole="button"
            accessibilityLabel={t('vocabulary:deck.iKnowThisWord')}
          >
            {({ pressed }) => (
              <View style={s.pillWrap}>
                <View style={[s.pillEdge, s.knowEdge]} />
                <View
                  style={[s.pillFace, s.knowFace, pressed && s.pillFacePressed]}
                >
                  <Text style={s.knowLabel}>{t('vocabulary:deck.knowIt')}</Text>
                </View>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={s.pillWrap} />
        )}

        <Pressable
          onPress={withTap(doUndo)}
          disabled={!canUndo}
          accessibilityRole="button"
          accessibilityLabel={t('vocabulary:deck.previousCard')}
        >
          {({ pressed }) => (
            <View style={[s.undoWrap, !canUndo && s.undoDisabled]}>
              <View style={s.undoEdge} />
              <View style={[s.undoFace, pressed && canUndo && s.undoFacePressed]}>
                {/* A circular arrow, not the angular undo hook: this button
                    brings the previous card round again, and the round glyph
                    says "again" where the hook said "revert an edit".

                    Still through `directionalIcon`, which passes an unmirrored
                    name straight through — a full circle has no reading
                    direction to flip, and routing every Ionicon through it is
                    what makes the ones that DO need mirroring impossible to
                    forget. */}
                <Ionicons name={directionalIcon('reload')} size={19} color={tc.goldOnSurface} />
              </View>
            </View>
          )}
        </Pressable>

        <Pressable
          onPress={withTap(() => doAdvance('button'))}
          accessibilityRole="button"
          accessibilityLabel={t('vocabulary:deck.nextCard')}
        >
          {({ pressed }) => (
            <View style={s.pillWrap}>
              <View style={[s.pillEdge, s.nextEdge]} />
              <View style={[s.pillFace, s.nextFace, pressed && s.pillFacePressed]}>
                <Text style={s.nextLabel}>{t('vocabulary:deck.next')}</Text>
              </View>
            </View>
          )}
        </Pressable>
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

const makeDeckStyles = (tc: ThemeColors, scheme: 'light' | 'dark') => {
  const light = scheme === 'light';
  return StyleSheet.create({
    // Claims what the fixed column leaves, and reports it back through
    // onLayout so the deck zone can scale into it.
    // Centred in whatever the column has left, rather than pinned to the top
    // with the slack pooling underneath.
    //
    // `deckMetrics` caps the card's scale at 1, so on anything larger than an
    // iPhone SE the block is smaller than its container and there is real
    // slack to place. It used to sit entirely below the deck, which read as
    // the card hanging off the hero rather than being the screen's subject —
    // and that gap grew by 24 the moment the poster's height left the column.
    //
    // `paddingTop` stays as the minimum clearance from the block above, for
    // the small phones where centring has nothing left to distribute.
    wrap: {
      flex: 1,
      justifyContent: 'center',
      paddingTop: DECK_GAP_TOP,
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
    // The heart glyph draws about a point smaller than the star it replaced,
    // so 23 keeps it the same optical size inside the 24pt meta row.
    wordSlot: {
      marginTop: WORD_SLOT_TOP,
      height: WORD_SLOT_HEIGHT,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    // The headword and its speaker, on one line — the word feed's arrangement.
    // Centred rather than bottom-aligned: on the one-line tier the chip lands
    // on the word's optical middle, and on the two-line tier it sits level
    // with the gap instead of hanging off the descenders of the last line.
    wordRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    wordSpeaker: {
      marginStart: DECK_SPEAKER_GAP,
    },
    word: {
      // Shrink, don't grow. `flex: 1` would push the chip to the card's
      // trailing edge and break the "beside the word" reading.
      flexShrink: 1,
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      letterSpacing: -0.3,
      color: tc.text,
    },
    definitionSlot: {
      marginTop: DEFINITION_SLOT_TOP,
      height: DEFINITION_SLOT_HEIGHT,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    definition: {
      // Italic and secondary, the same treatment the Explore card gives it:
      // commentary on the headword above, not a rival to the sentence below.
      // Its own family, because Georgia's italic barely slants at this size —
      // see SERIF_ITALIC_FAMILY.
      //
      // No optical size correction here, unlike the Explore card: the gloss
      // sits in a fixed-height slot with a 2-line clamp (definitionTier), so
      // growing the type to match its neighbours would ellipsize long glosses
      // rather than fix anything. The family is metrically matched to the
      // Georgia around it instead — within 1.4%, guarded in fonts.test.ts.
      fontFamily: SERIF_ITALIC_FAMILY,
      fontStyle: 'italic',
      color: light ? '#7A6A50' : tc.textFaint,
    },
    definitionPos: {
      // Upright inside the italic line and gold, matching the Explore card.
      // `fontStyle` must be restated: a nested Text inherits the parent's.
      fontStyle: 'normal',
      fontWeight: '600',
      color: tc.goldOnSurface,
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
      // Overridden per card with the band's colour — see the call site. The
      // token stays as the fallback for a card rendered without one.
      color: tc.primaryOnSurface,
      // Takes the whole line and gives the rest back, so the language tag
      // beside it sits at the trailing edge — exactly where the dashed rule
      // leaves it on the hidden layer underneath. Without the grow the tag
      // rides directly behind the word and travels a variable distance on
      // every reveal, because the distance is the length of the translation.
      //
      // `minWidth: 0` is what actually lets it shrink: a flex child will not
      // go below its own content width without it, so a long translation
      // pushes the tag off the card's trailing edge instead of ellipsising.
      // The `numberOfLines={1}` at the call site is the other half — the row
      // cannot wrap, so an unshrinkable child has nowhere to go but out.
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    },
    // "same as English" is a statement about the word, not the word's
    // translation — lighter and unbolded so it doesn't read as the answer.
    wordTranslationSameAsSource: {
      fontWeight: '400',
      color: tc.textSecondary,
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
    sentenceLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: SENTENCE_LABEL_TOP,
      height: SENTENCE_LABEL_HEIGHT,
    },
    sentenceLabelText: {
      fontFamily: MONO_FAMILY,
      fontSize: 8.5,
      lineHeight: SENTENCE_LABEL_HEIGHT,
      fontWeight: '700',
      letterSpacing: 1.19,
      color: tc.labelFaint,
    },
    sentenceLabelRule: {
      flex: 1,
      height: 1,
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
      paddingStart: 12,
      gap: 12,
    },
    sentenceTrRevealed: {
      borderStartWidth: 2,
      borderStartColor: tc.gold,
      paddingStart: 12,
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
    // The footer's icons are drawn now (they were ⚐ and 🔊 inside the text
    // run, sitting on the baseline and scaling with the font), so the label
    // gets a row of its own to sit in beside them.
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    actionText: {
      fontSize: 11,
      fontWeight: '600',
      color: tc.textFaint,
    },
    tapHint: {
      marginStart: 'auto',
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.9,
      color: light ? '#C0A66B' : 'rgba(255,209,102,0.55)',
    },
    // `space-between` inside a `row` — Yoga mirrors it under RTL on its own,
    // and nothing here is positioned with an absolute left/right.
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: ACTIONS_ROW_HEIGHT,
      marginTop: ACTIONS_GAP,
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
    // The pair reads as one decision with two answers, so they share a shape
    // and differ only in weight: the affirmative is an outline, the neutral
    // one carries the fill. Neither has a glyph any more — a tick beside the
    // word "I know it" and an arrow beside "Next" each said the label again,
    // and two words are quicker to read than a word plus a symbol.
    knowEdge: {
      // Derived from the token rather than a hand-mixed green, so it follows
      // `success` if that ever moves. It was rgba(63,139,123,0.28), which is
      // the dark theme's success at 28% — frozen, and wrong in light mode.
      backgroundColor: withAlpha(tc.success, 0.28),
    },
    knowFace: {
      backgroundColor: tc.paper,
      borderWidth: 1.5,
      borderColor: tc.success,
    },
    knowLabel: {
      color: tc.success,
      fontSize: 14,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    nextEdge: {
      backgroundColor: tc.nodeGoldEdge,
    },
    // Flat gold, not a two-stop gradient of frozen hexes. This is the app's
    // primary button — the same fill and ink every sheet's Done wears — and
    // it was the one place a gradient appeared, which made the deck's main
    // action look like it came from a different app than the sheets.
    nextFace: {
      backgroundColor: tc.gold,
    },
    nextLabel: {
      color: tc.goldDeep,
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.2,
    },
    undoWrap: {
      width: UNDO_SIZE,
      height: UNDO_SIZE + UNDO_EDGE,
    },
    undoEdge: {
      position: 'absolute',
      top: UNDO_EDGE,
      start: 0,
      width: UNDO_SIZE,
      height: UNDO_SIZE,
      borderRadius: UNDO_SIZE / 2,
      backgroundColor: light ? 'rgba(45,36,24,0.08)' : 'rgba(0,0,0,0.4)',
    },
    // Same construction as the pills — paper face, 1.5pt rim — but on the
    // gold hairline rather than the neutral border, so the three controls
    // under the deck read as one family in the app's own accent instead of
    // two coloured buttons and a grey one.
    undoFace: {
      width: UNDO_SIZE,
      height: UNDO_SIZE,
      borderRadius: UNDO_SIZE / 2,
      backgroundColor: tc.paper,
      borderWidth: 1.5,
      borderColor: tc.goldLine,
      alignItems: 'center',
      justifyContent: 'center',
    },
    undoFacePressed: {
      transform: [{ translateY: UNDO_EDGE - 1 }],
    },
    undoDisabled: {
      opacity: 0.35,
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

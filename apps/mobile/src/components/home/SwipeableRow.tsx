/**
 * SwipeableRow — horizontal swipe-to-act wrapper for a home-feed movie card.
 *
 * Swiping toward the trailing edge reveals a green "Seen it" backdrop
 * (→ Watched list); toward the leading edge reveals a red "Not interested"
 * backdrop (→ hidden). In LTR that reads as right/left; under RTL both the
 * backdrops and the gesture flip, so it reads as left/right. Built on
 * PanResponder + Animated (no native gesture library) so it ships as an OTA
 * update. The responder only claims clearly-horizontal drags
 * (shouldClaimHorizontal), so vertical scrolls still reach the FlashList and
 * taps still open the card.
 *
 * Yoga mirrors the backdrops for free (they are `justifyContent` inside a
 * `flexDirection: 'row'`), but `dx` and `translateX` are always physical
 * pixels — so this component works in *logical* offsets (positive = dragged
 * toward the trailing edge, whichever side that is) and converts back to
 * physical only in the final transform. Without that the label and the action
 * point opposite ways under RTL: the card you uncover is not the one you
 * commit.
 *
 * The decision thresholds live in utils/swipeDecision (pure + unit-tested);
 * this component owns only the Animated wiring.
 */

import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { directionSign } from '../../i18n/rtl';
import {
  shouldClaimHorizontal,
  shouldResetSwipeOffset,
  swipeActionOnRelease,
  SWIPE_COMMIT_DX,
  type SwipeAction,
} from '../../utils/swipeDecision';

interface Props {
  children: React.ReactNode;
  onSwipe: (action: SwipeAction) => void;
  /** Height of the wrapped card, used to size the action backdrops. */
  height: number;
  /** Disable swiping (e.g. while a previous action is settling). */
  disabled?: boolean;
  /** Identity of the item this row is currently showing (the movie id). When it
   *  changes, the row has been recycled onto a different movie and the drag
   *  offset is snapped back to 0. Lets the list reuse the row instead of keying
   *  — and remounting — the whole subtree per movie. */
  resetKey?: string | number;
}

// Far enough that the card fully clears the widest phone before we fire the
// action and the parent removes the row.
const OFFSCREEN = 700;

export function SwipeableRow({ children, onSwipe, height, disabled, resetKey }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // Logical drag offset: positive = toward the trailing edge, in both reading
  // directions. Thresholds and backdrop opacities are all expressed here; only
  // the transform at the bottom converts back to physical pixels.
  const translate = useRef(new Animated.Value(0)).current;

  // Recycle reset. Deliberately during render rather than in an effect: an
  // effect runs after the new movie has already painted, so the row would show
  // one frame still translated off-screen with the old action backdrop behind
  // it — the exact artefact this guards against. Writing to a ref-held
  // Animated.Value is not React state, so there is no re-render to loop on, and
  // the write is idempotent if render is replayed.
  const shownKey = useRef(resetKey);
  if (shouldResetSwipeOffset(shownKey.current, resetKey)) {
    shownKey.current = resetKey;
    // Kill any still-running settle animation first, or it would keep driving
    // the value after the reset and re-strand the row off-screen.
    translate.stopAnimation();
    translate.setValue(0);
  }
  // Memoized because every new multiply node re-attaches a native animated
  // node, and these rows re-render as the feed scrolls.
  const translateX = useMemo(() => Animated.multiply(translate, directionSign), [translate]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => !disabled && shouldClaimHorizontal(g.dx, g.dy),
        // Capture the horizontal swipe *before* the FlashList's scroll can grab
        // it — this is what stops left/right slides from being stolen by an
        // up/down scroll. Vertical drags fail shouldClaimHorizontal and fall
        // through to the list.
        onMoveShouldSetPanResponderCapture: (_e, g) => !disabled && shouldClaimHorizontal(g.dx, g.dy),
        // Once we're swiping, don't let the scroll view reclaim the gesture on
        // a bit of vertical jitter — keeps the slide smooth to release.
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => translate.setValue(g.dx * directionSign),
        onPanResponderRelease: (_e, g) => {
          const action = swipeActionOnRelease(g.dx * directionSign, g.vx * directionSign);
          if (!action) {
            Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            return;
          }
          Animated.timing(translate, {
            toValue: action === 'watched' ? OFFSCREEN : -OFFSCREEN,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onSwipe(action));
        },
        onPanResponderTerminate: () => {
          Animated.spring(translate, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [disabled, onSwipe, translate],
  );

  // Backdrops fade in with drag distance: trailing-edge swipe → green,
  // leading-edge swipe → red. Yoga puts each label on the side the card
  // uncovers, so these read the same logical offset the action does.
  const watchedOpacity = translate.interpolate({
    inputRange: [0, SWIPE_COMMIT_DX],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const hiddenOpacity = translate.interpolate({
    inputRange: [-SWIPE_COMMIT_DX, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[s.wrap, { height }]}>
      <Animated.View style={[s.backdrop, s.watched, { opacity: watchedOpacity }]}>
        <Ionicons name="checkmark-circle" size={22} color="#fff" />
        <Text style={s.label}>{t('home:swipe.seenIt')}</Text>
      </Animated.View>
      <Animated.View style={[s.backdrop, s.hidden, { opacity: hiddenOpacity }]}>
        <Text style={s.label}>{t('home:swipe.notInterested')}</Text>
        <Ionicons name="close-circle" size={22} color="#fff" />
      </Animated.View>
      <Animated.View style={[s.card, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: 'relative' },
    card: { flex: 1 },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 14,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 22,
      gap: 8,
    },
    watched: { backgroundColor: tc.success, justifyContent: 'flex-start' },
    hidden: { backgroundColor: tc.error, justifyContent: 'flex-end' },
    label: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  });

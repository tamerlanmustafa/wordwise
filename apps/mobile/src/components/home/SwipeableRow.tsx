/**
 * SwipeableRow — horizontal swipe-to-act wrapper for a home-feed movie card.
 *
 * Swipe right reveals a green "Seen it" backdrop (→ Watched list); swipe left
 * reveals a red "Not interested" backdrop (→ hidden). Built on PanResponder +
 * Animated (no native gesture library) so it ships as an OTA update. The
 * responder only claims clearly-horizontal drags (shouldClaimHorizontal), so
 * vertical scrolls still reach the FlashList and taps still open the card.
 *
 * The decision thresholds live in utils/swipeDecision (pure + unit-tested);
 * this component owns only the Animated wiring.
 */

import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import {
  shouldClaimHorizontal,
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
}

// Far enough that the card fully clears the widest phone before we fire the
// action and the parent removes the row.
const OFFSCREEN = 700;

export function SwipeableRow({ children, onSwipe, height, disabled }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const translateX = useRef(new Animated.Value(0)).current;

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
        onPanResponderMove: (_e, g) => translateX.setValue(g.dx),
        onPanResponderRelease: (_e, g) => {
          const action = swipeActionOnRelease(g.dx, g.vx);
          if (!action) {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
            return;
          }
          Animated.timing(translateX, {
            toValue: action === 'watched' ? OFFSCREEN : -OFFSCREEN,
            duration: 200,
            useNativeDriver: true,
          }).start(() => onSwipe(action));
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [disabled, onSwipe, translateX],
  );

  // Backdrops fade in with drag distance: right swipe → green (left edge),
  // left swipe → red (right edge).
  const watchedOpacity = translateX.interpolate({
    inputRange: [0, SWIPE_COMMIT_DX],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const hiddenOpacity = translateX.interpolate({
    inputRange: [-SWIPE_COMMIT_DX, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={[s.wrap, { height }]}>
      <Animated.View style={[s.backdrop, s.watched, { opacity: watchedOpacity }]}>
        <Ionicons name="checkmark-circle" size={22} color="#fff" />
        <Text style={s.label}>Seen it</Text>
      </Animated.View>
      <Animated.View style={[s.backdrop, s.hidden, { opacity: hiddenOpacity }]}>
        <Text style={s.label}>Not interested</Text>
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

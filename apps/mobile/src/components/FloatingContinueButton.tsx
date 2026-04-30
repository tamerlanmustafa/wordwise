/**
 * FloatingContinueButton — draggable, edge-snapping, expand/collapse pill.
 *
 * Touch handling is done entirely inside PanResponder so there's no
 * conflict between PanResponder and TouchableOpacity. We distinguish
 * tap vs drag by total movement in onPanResponderRelease.
 *
 *   TAP   (Δ < 8pt) → toggle expand/collapse
 *   DRAG  (Δ ≥ 8pt) → snap to nearest edge
 *   LONG  (> 500ms) → open the movie
 */

import { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/palette';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const CIRCLE           = 52;
const PILL_W           = 220;
const MARGIN           = 14;
const BOTTOM_CLEARANCE = 100;
const TAP_THRESHOLD    = 8;    // max movement (px) to count as a tap
const LONG_PRESS_MS    = 500;

const INIT_X = SCREEN_W - CIRCLE - MARGIN;
const INIT_Y = SCREEN_H - 220;

interface Props {
  movie: { title: string; poster_path: string | null };
  onPress: () => void;
}

export function FloatingContinueButton({ movie, onPress }: Props) {
  // ── position ──────────────────────────────────────────────────────────
  const pan = useRef(new Animated.ValueXY({ x: INIT_X, y: INIT_Y })).current;
  const sideRef = useRef<'left' | 'right'>('right');

  const rawPanX = () => (pan.x as any)._value as number;
  const rawPanY = () => (pan.y as any)._value as number;

  const springTo = (x: number, y: number) =>
    Animated.spring(pan, {
      toValue: { x, y },
      useNativeDriver: false,
      bounciness: 5,
    }).start();

  const snapX = (side: 'left' | 'right', expanded: boolean) =>
    side === 'right'
      ? SCREEN_W - (expanded ? PILL_W : CIRCLE) - MARGIN
      : MARGIN;

  // ── expand / collapse ─────────────────────────────────────────────────
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandedRef = useRef(false);
  const expandAnim    = useRef(new Animated.Value(0)).current;

  const textWidth = expandAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0, PILL_W - CIRCLE - 24],
  });
  const textOpacity = expandAnim.interpolate({
    inputRange:  [0, 0.4, 1],
    outputRange: [0, 0, 1],
  });

  // Timestamp guard — if the previous toggle animation hasn't had time
  // to start (< 280ms ago), ignore the tap. This prevents the spring
  // from being restarted mid-bounce, which causes the visual glitch on
  // rapid taps.
  const lastToggleAt = useRef(0);

  const toggleExpand = () => {
    const now = Date.now();
    if (now - lastToggleAt.current < 280) return;
    lastToggleAt.current = now;

    const next = !isExpandedRef.current;
    isExpandedRef.current = next;
    setIsExpanded(next);

    // Stop any in-flight pan animation and read the settled position
    // before starting the new one, so we never spring from a mid-frame
    // value.
    pan.stopAnimation();
    springTo(snapX(sideRef.current, next), rawPanY());

    // Timing (not spring) for expand: no bounciness means rapid back-
    // and-forth toggles look clean instead of overshooting.
    expandAnim.stopAnimation();
    Animated.timing(expandAnim, {
      toValue: next ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  // ── PanResponder ──────────────────────────────────────────────────────
  const dragDist   = useRef(0);
  const touchStart = useRef(0);       // timestamp to detect long-press
  const longTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:       () => true,
      onStartShouldSetPanResponderCapture:() => true,
      onMoveShouldSetPanResponder:        () => true,

      onPanResponderGrant: () => {
        dragDist.current   = 0;
        touchStart.current = Date.now();

        // Schedule long-press action.
        if (longTimer.current) clearTimeout(longTimer.current);
        longTimer.current = setTimeout(() => {
          longTimer.current = null;
          onPress();
        }, LONG_PRESS_MS);

        // Stop any running animation first so rawPanX/Y read the
        // actual settled (or mid-frame) position cleanly before we
        // move the offset anchor.
        pan.stopAnimation();
        pan.setOffset({ x: rawPanX(), y: rawPanY() });
        pan.setValue({ x: 0, y: 0 });
      },

      onPanResponderMove: (_, gs) => {
        const dist = Math.abs(gs.dx) + Math.abs(gs.dy);
        dragDist.current = Math.max(dragDist.current, dist);

        // Cancel long-press if user starts dragging.
        if (dist >= TAP_THRESHOLD && longTimer.current) {
          clearTimeout(longTimer.current);
          longTimer.current = null;
        }

        Animated.event(
          [null, { dx: pan.x, dy: pan.y }],
          { useNativeDriver: false },
        )(_, gs);
      },

      onPanResponderRelease: () => {
        // Cancel any pending long-press.
        if (longTimer.current) {
          clearTimeout(longTimer.current);
          longTimer.current = null;
        }

        pan.flattenOffset();

        const wasTap = dragDist.current < TAP_THRESHOLD;

        if (wasTap) {
          // Tap → toggle expand, keep snapped position.
          toggleExpand();
        } else {
          // Drag → snap to nearest edge, keep expanded state.
          const cx  = rawPanX() + (isExpandedRef.current ? PILL_W : CIRCLE) / 2;
          const side: 'left' | 'right' = cx < SCREEN_W / 2 ? 'left' : 'right';
          sideRef.current = side;

          const clampedY = Math.min(
            Math.max(80, rawPanY()),
            SCREEN_H - BOTTOM_CLEARANCE - CIRCLE,
          );
          springTo(snapX(side, isExpandedRef.current), clampedY);
        }
      },
    }),
  ).current;

  // ── render ─────────────────────────────────────────────────────────────
  const onRight = sideRef.current === 'right';

  const poster = (
    <View style={styles.circle}>
      {movie.poster_path ? (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w92${movie.poster_path}` }}
          style={styles.posterImg}
        />
      ) : (
        <View style={[styles.posterImg, { backgroundColor: colors.border }]} />
      )}
    </View>
  );

  const textBlock = (
    <Animated.View
      style={[
        styles.textArea,
        { width: textWidth, opacity: textOpacity },
        onRight ? styles.textAreaRight : styles.textAreaLeft,
      ]}
    >
      <Text style={styles.label} numberOfLines={1}>CONTINUE</Text>
      <Text style={styles.title} numberOfLines={1}>{movie.title}</Text>
    </Animated.View>
  );

  return (
    <Animated.View
      style={[styles.container, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      <View style={styles.pill}>
        {onRight ? <>{textBlock}{poster}</> : <>{poster}{textBlock}</>}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.20,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    height: CIRCLE + 4,
  },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
    flexShrink: 0,
  },
  posterImg: {
    width: CIRCLE,
    height: CIRCLE,
  },
  textArea: {
    overflow: 'hidden',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textAreaLeft: { paddingLeft: 12, paddingRight: 8 },
  textAreaRight: { paddingLeft: 8, paddingRight: 12 },
  label: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    marginTop: 1,
  },
});

import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';
import { useThemeColors, useColorScheme } from '../../theme/tokens';
import { directionSign } from '../../i18n/rtl';

interface Props {
  wordKey: string;
  onLayoutY: (word: string, y: number) => void;
  onBookmark: (word: string) => void;
  onMarkLearned?: (word: string) => void;
  isCurrentBookmark: boolean;
  children: React.ReactNode;
}

// "Where you left off" row wrapper.
// Reports its vertical offset via onLayout so the parent can scrollTo, and
// pulses a warm gold background when `pulse` flips true — Kindle-style
// "you were here" marker that fades away without demanding attention.
// Swipe a row toward the trailing edge past a threshold to mark this word as
// "leave off here" — the resume point for next time you open the movie. Under
// RTL that is a leftward swipe, because the gesture mirrors with the layout.
// Also pulses in warm gold when re-entered with this word as the bookmark.
const _BookmarkRowWrapper = ({
  wordKey,
  onLayoutY,
  onBookmark,
  onMarkLearned,
  isCurrentBookmark,
  children,
}: Props) => {
  const tc = useThemeColors();
  const dark = useColorScheme() === 'dark';
  // Logical offset: positive = dragged toward the trailing edge, in both
  // reading directions. Everything below — thresholds, reveal opacity, the
  // `direction` state — is expressed in these coordinates, and only the final
  // transform converts back to physical pixels.
  const translate = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const [direction, setDirection] = useState<'trailing' | 'leading' | null>(null);
  const triggeredRef = useRef(false);

  const THRESHOLD = 90;
  // Refs so the PanResponder (captured once) always sees fresh callbacks.
  const onBookmarkRef = useRef(onBookmark);
  const onMarkLearnedRef = useRef(onMarkLearned);
  const wordKeyRef = useRef(wordKey);
  useEffect(() => { onBookmarkRef.current = onBookmark; }, [onBookmark]);
  useEffect(() => { onMarkLearnedRef.current = onMarkLearned; }, [onMarkLearned]);
  useEffect(() => { wordKeyRef.current = wordKey; }, [wordKey]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && Math.abs(g.dx) > 10,
      onPanResponderGrant: () => {
        triggeredRef.current = false;
        setDragging(true);
      },
      onPanResponderMove: (_, g) => {
        const x = Math.max(-160, Math.min(g.dx * directionSign, 160));
        translate.setValue(x);
        setDirection(x > 0 ? 'trailing' : x < 0 ? 'leading' : null);
      },
      onPanResponderRelease: (_, g) => {
        setDragging(false);
        const dx = g.dx * directionSign;
        if (dx > THRESHOLD && !triggeredRef.current) {
          triggeredRef.current = true;
          onBookmarkRef.current(wordKeyRef.current);
          Animated.sequence([
            Animated.timing(translate, { toValue: 130, duration: 110, useNativeDriver: true }),
            Animated.timing(translate, { toValue: 0, duration: 260, useNativeDriver: true }),
          ]).start(() => setDirection(null));
        } else if (dx < -THRESHOLD && !triggeredRef.current && onMarkLearnedRef.current) {
          triggeredRef.current = true;
          // Snap back; the parent's LayoutAnimation handles the fade + collapse
          // of the row itself.
          Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start(() => setDirection(null));
          onMarkLearnedRef.current(wordKeyRef.current);
        } else {
          Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(() => setDirection(null));
        }
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.spring(translate, { toValue: 0, useNativeDriver: true }).start(() => setDirection(null));
      },
    })
  ).current;

  // Dragging toward the trailing edge uncovers the leading-edge pane, and
  // vice versa — hence the crossed naming.
  const leadingRevealOpacity = translate.interpolate({
    inputRange: [0, 30, 160],
    outputRange: [0, 0.7, 1],
    extrapolate: 'clamp',
  });
  const trailingRevealOpacity = translate.interpolate({
    inputRange: [-160, -30, 0],
    outputRange: [1, 0.7, 0],
    extrapolate: 'clamp',
  });

  const showLeadingReveal = dragging || direction === 'trailing';
  const showTrailingReveal = (dragging || direction === 'leading') && !!onMarkLearned;
  // While the row slides, back it with an opaque paper fill + soft edge shadow
  // so the reveal never bleeds through the row content.
  const revealing = showLeadingReveal || showTrailingReveal;
  const bookmarkLabelColor = dark ? tc.goldDeep : '#FFFFFF';

  return (
    <View
      onLayout={(e) => onLayoutY(wordKey, e.nativeEvent.layout.y)}
      style={{ overflow: 'hidden' }}
    >
      {showLeadingReveal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            start: 0,
            top: 0,
            bottom: 0,
            width: 160,
            backgroundColor: isCurrentBookmark ? tc.error : tc.gold,
            justifyContent: 'center',
            paddingStart: 16,
            opacity: leadingRevealOpacity,
          }}
        >
          <Text style={{ color: isCurrentBookmark ? '#FFFFFF' : bookmarkLabelColor, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
            {isCurrentBookmark ? '✕  Remove bookmark' : 'Leave off here'}
          </Text>
        </Animated.View>
      )}
      {showTrailingReveal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            end: 0,
            top: 0,
            bottom: 0,
            width: 160,
            backgroundColor: tc.success,
            justifyContent: 'center',
            alignItems: 'flex-end',
            paddingEnd: 16,
            opacity: trailingRevealOpacity,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
            ✓  I know this
          </Text>
        </Animated.View>
      )}
      <Animated.View
        style={{
          transform: [{ translateX: Animated.multiply(translate, directionSign) }],
          backgroundColor: revealing ? tc.paper : undefined,
          ...(revealing
            ? {
                shadowColor: '#000',
                shadowOpacity: 0.14,
                shadowRadius: 9,
                shadowOffset: { width: 0, height: 0 },
                elevation: 6,
              }
            : null),
        }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

export const BookmarkRowWrapper = memo(_BookmarkRowWrapper);

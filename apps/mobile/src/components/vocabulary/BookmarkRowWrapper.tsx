import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

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
// Swipe a row to the right past a threshold to mark this word as
// "leave off here" — the resume point for next time you open the movie.
// Also pulses in warm gold when re-entered with this word as the bookmark.
const _BookmarkRowWrapper = ({
  wordKey,
  onLayoutY,
  onBookmark,
  onMarkLearned,
  isCurrentBookmark,
  children,
}: Props) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const [direction, setDirection] = useState<'right' | 'left' | null>(null);
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
        const x = Math.max(-160, Math.min(g.dx, 160));
        translateX.setValue(x);
        setDirection(x > 0 ? 'right' : x < 0 ? 'left' : null);
      },
      onPanResponderRelease: (_, g) => {
        setDragging(false);
        if (g.dx > THRESHOLD && !triggeredRef.current) {
          triggeredRef.current = true;
          onBookmarkRef.current(wordKeyRef.current);
          Animated.sequence([
            Animated.timing(translateX, { toValue: 130, duration: 110, useNativeDriver: true }),
            Animated.timing(translateX, { toValue: 0, duration: 260, useNativeDriver: true }),
          ]).start(() => setDirection(null));
        } else if (g.dx < -THRESHOLD && !triggeredRef.current && onMarkLearnedRef.current) {
          triggeredRef.current = true;
          // Snap translateX back; the parent's LayoutAnimation handles the
          // fade + collapse of the row itself.
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start(() => setDirection(null));
          onMarkLearnedRef.current(wordKeyRef.current);
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(() => setDirection(null));
        }
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(() => setDirection(null));
      },
    })
  ).current;

  const rightRevealOpacity = translateX.interpolate({
    inputRange: [0, 30, 160],
    outputRange: [0, 0.7, 1],
    extrapolate: 'clamp',
  });
  const leftRevealOpacity = translateX.interpolate({
    inputRange: [-160, -30, 0],
    outputRange: [1, 0.7, 0],
    extrapolate: 'clamp',
  });

  const showRightReveal = dragging || direction === 'right';
  const showLeftReveal = (dragging || direction === 'left') && !!onMarkLearned;

  return (
    <View
      onLayout={(e) => onLayoutY(wordKey, e.nativeEvent.layout.y)}
      style={{ overflow: 'hidden' }}
    >
      {showRightReveal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 160,
            backgroundColor: isCurrentBookmark ? '#E53935' : '#7C5CBF',
            justifyContent: 'center',
            paddingLeft: 16,
            opacity: rightRevealOpacity,
          }}
        >
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
            {isCurrentBookmark ? '✕  Remove bookmark' : '🔖  Leave off here'}
          </Text>
        </Animated.View>
      )}
      {showLeftReveal && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 160,
            backgroundColor: '#2E7D32',
            justifyContent: 'center',
            alignItems: 'flex-end',
            paddingRight: 16,
            opacity: leftRevealOpacity,
          }}
        >
          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
            ✓  I know this
          </Text>
        </Animated.View>
      )}
      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

export const BookmarkRowWrapper = memo(_BookmarkRowWrapper);

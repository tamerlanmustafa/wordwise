/**
 * PosterFlight — global overlay that plays the "added to reel" poster
 * flight animation. Mounted once at the App root; listens for `pending`
 * entries on flightStore and animates a small poster from the source
 * rect to the Reel tab's center in a brief parabolic arc.
 *
 * Pointer events pass through; this layer is purely decorative.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { useFlightStore, type FlightSpec, type Rect } from '../stores/flightStore';

const DURATION = 700;
// How far above the straight-line midpoint the poster arcs.
const ARC_HEIGHT = 80;
// Destination poster footprint at the tab.
const LANDING_SIZE = 28;
const FALLBACK_BG = '#221710';

function posterUri(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

interface ActiveFlight {
  spec: FlightSpec;
  to: Rect;
}

export function PosterFlight() {
  const pending = useFlightStore((s) => s.pending);
  const reelTabRect = useFlightStore((s) => s.reelTabRect);
  const consume = useFlightStore((s) => s.consume);

  const [active, setActive] = useState<ActiveFlight | null>(null);
  const progress = useRef(new Animated.Value(0)).current;

  // Pick up a new pending flight whenever one arrives AND we know where
  // the tab lives. If reelTabRect isn't known yet (bar hasn't laid out),
  // we silently drop the flight — better than animating to (0,0).
  useEffect(() => {
    if (!pending) return;
    if (!reelTabRect) {
      consume();
      return;
    }
    setActive({ spec: pending, to: reelTabRect });
    consume();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setActive(null);
    });
  }, [pending, reelTabRect, consume, progress]);

  if (!active) return null;

  const { spec, to } = active;
  const fromCx = spec.from.x + spec.from.width / 2;
  const fromCy = spec.from.y + spec.from.height / 2;
  const toCx   = to.x + to.width / 2;
  const toCy   = to.y + to.height / 2;
  const startW = spec.from.width;
  const startH = spec.from.height;
  const endW   = LANDING_SIZE;
  const endH   = LANDING_SIZE * 1.5;

  // Center the moving box at the source initially; we translate to
  // (toCx - sourceW/2, toCy - sourceH/2) and scale toward the target
  // footprint as we go.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fromCx - startW / 2, toCx - startW / 2],
  });
  // Y travels along a downward arc: at t=0.5 we sit ARC_HEIGHT above
  // the linear midpoint. Implemented as two segments interpolated
  // through the midpoint so the path looks like a thrown poster.
  const linearMidY = (fromCy + toCy) / 2;
  const arcY = linearMidY - ARC_HEIGHT;
  const translateY = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [
      fromCy - startH / 2,
      arcY - startH / 2,
      toCy - startH / 2,
    ],
  });
  const scaleX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, endW / startW],
  });
  const scaleY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, endH / startH],
  });
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '18deg'],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 1, 0],
  });

  const uri = posterUri(spec.posterPath);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.poster,
          {
            width: startW,
            height: startH,
            transform: [
              { translateX },
              { translateY },
              { scaleX },
              { scaleY },
              { rotate },
            ],
            opacity,
          },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, { backgroundColor: FALLBACK_BG }]} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  poster: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});

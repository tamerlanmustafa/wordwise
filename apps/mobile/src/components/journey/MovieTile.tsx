/**
 * MovieTile — a single film-cell on the Journey Reel. Every tile is
 * evergreen: same size, always tappable, no gating. The caller can
 * optionally pass `quizzed` to show a small ✓ stamp on movies the user
 * has completed at least one quiz session for.
 *
 * The tile is positioned by its parent at the tile's *center*
 * coordinates; this component sizes itself and centers within that
 * point.
 */

import { useRef } from 'react';
import {
  Animated,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { NodeLevel } from './JourneyNode';

export interface MovieTileProps {
  idx: number;
  label: number;
  level: NodeLevel;
  movie: string;
  poster: string | null;
  /** Center X within the parent container. */
  centerX: number;
  /** Center Y within the parent container. */
  centerY: number;
  /** True when the user has completed at least one quiz session for
   *  this movie — surfaced as a small gold ✓ stamp. Optional. */
  quizzed?: boolean;
  /** True while the parent is fetching the preview-hub payload for
   *  this tile. Used to lock further presses and render a subtle
   *  scale-in feedback. Optional. */
  busy?: boolean;
  onPress?: () => void;
}

const CEFR_COLOR: Record<NodeLevel, string> = {
  A1: '#4CAF50',
  A2: '#8BC34A',
  B1: '#FFC107',
  B2: '#FF9800',
  C1: '#F44336',
  C2: '#9C27B0',
};
const GOLD = '#FFD166';
const STOCK = '#1a1109';
const FRAME_BG = '#221710';

const TILE_SIZE  = 72;
const BADGE_SIZE = 24;

function tmdb(path: string) {
  return `https://image.tmdb.org/t/p/w185${path}`;
}

export function MovieTile({
  idx: _idx,
  label,
  level,
  movie,
  poster,
  centerX,
  centerY,
  quizzed,
  busy,
  onPress,
}: MovieTileProps) {
  const accent = CEFR_COLOR[level] ?? CEFR_COLOR.A1;
  const left = centerX - TILE_SIZE / 2;
  const top = centerY - TILE_SIZE / 2;

  // Press scale.
  const press = useRef(new Animated.Value(0)).current;
  const onPressIn = () => {
    Animated.timing(press, {
      toValue: 1, duration: 120, useNativeDriver: true,
    }).start();
  };
  const onPressOut = () => {
    Animated.timing(press, {
      toValue: 0, duration: 120, useNativeDriver: true,
    }).start();
  };
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });

  return (
    <View
      style={[
        styles.wrapper,
        { left, top, width: TILE_SIZE, height: TILE_SIZE, opacity: busy ? 0.7 : 1 },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        disabled={busy}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={{ width: TILE_SIZE, height: TILE_SIZE }}
      >
        <Animated.View
          style={[
            styles.frame,
            styles.baseShadow,
            {
              width: TILE_SIZE,
              height: TILE_SIZE,
              borderColor: accent,
              transform: [{ scale }],
            },
          ]}
        >
          {poster ? (
            <Image
              source={{ uri: tmdb(poster) }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.poster, { backgroundColor: FRAME_BG }]} />
          )}

          {/* Bottom title strip — always visible now that every tile is
              first-class. */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.92)']}
            style={styles.titleStrip}
            pointerEvents="none"
          >
            <Text numberOfLines={2} style={styles.titleText}>
              {movie}
            </Text>
          </LinearGradient>

          {/* Quizzed ✓ stamp — top-right, only after at least one
              completed quiz session. Replaces the old 'completed'
              state since the reel no longer has linear progression. */}
          {quizzed ? (
            <View style={styles.checkDisc} pointerEvents="none">
              <Text style={styles.checkGlyph}>✓</Text>
            </View>
          ) : null}
        </Animated.View>
      </Pressable>

      {/* Number badge — overflows top-left. Shows queue position. */}
      <View
        pointerEvents="none"
        style={[
          styles.badge,
          {
            width: BADGE_SIZE,
            height: BADGE_SIZE,
            borderRadius: BADGE_SIZE / 2,
            backgroundColor: quizzed ? GOLD : accent,
          },
        ]}
      >
        <Text
          style={{
            color: quizzed ? '#3a2400' : '#fff',
            fontSize: 11,
            fontWeight: '900',
          }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Legacy alias kept so JourneyScreen's prior import path still
 *  typechecks during the migration. The reel no longer uses the
 *  multi-state model; every tile is evergreen. */
export type TileState = 'evergreen';

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  frame: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: FRAME_BG,
    borderWidth: 2.5,
  },
  baseShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  titleStrip: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingTop: 12,
    paddingBottom: 5,
    paddingHorizontal: 6,
  },
  titleText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: Platform.OS === 'web' ? (9 * 1.2) : undefined,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  checkDisc: {
    position: 'absolute',
    top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  checkGlyph: {
    fontSize: 12, fontWeight: '900', color: '#3a2400',
  },
  badge: {
    position: 'absolute',
    top: -8, left: -4,
    borderWidth: 2.5,
    borderColor: STOCK,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});

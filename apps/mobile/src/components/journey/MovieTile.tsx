/**
 * MovieTile — single rectangular film-cell on the Journey Reel. Has
 * four visual states (active / completed / inactive / locked) driven
 * by the caller and exposes onPress only when active. The tile is
 * positioned by its parent at the tile's *center* coordinates; this
 * component sizes itself from `state` and centers within that center.
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

export type TileState = 'locked' | 'active' | 'inactive' | 'completed';

export interface MovieTileProps {
  idx: number;
  label: number;
  level: NodeLevel;
  movie: string;
  poster: string | null;
  state: TileState;
  /** Center X within the parent container. */
  centerX: number;
  /** Center Y within the parent container. */
  centerY: number;
  /** Where this tile came from: a user pick (★ in the badge) or a
   *  curated suggestion (number in the badge). Visual logic is
   *  otherwise identical across sources. */
  source?: 'user' | 'suggested';
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

const SIZE: Record<TileState, number> = {
  active: 92,
  inactive: 60,
  completed: 60,
  locked: 54,
};
const BADGE_SIZE: Record<TileState, number> = {
  active: 26,
  inactive: 22,
  completed: 22,
  locked: 22,
};

function tmdb(path: string) {
  return `https://image.tmdb.org/t/p/w185${path}`;
}

export function MovieTile({
  idx: _idx, label, level, movie, poster, state, centerX, centerY, source, onPress,
}: MovieTileProps) {
  // Number badge always shows queue position. The ★ for user picks
  // lives in a separate corner stamp so the user can still see "I'm
  // on tile 3 of my reel."
  const badgeContent = String(label);
  const accent = CEFR_COLOR[level] ?? CEFR_COLOR.A1;
  const size = SIZE[state];
  const badge = BADGE_SIZE[state];
  const isActive = state === 'active';
  const isCompleted = state === 'completed';
  const isLocked = state === 'locked';
  const isInactive = state === 'inactive';

  const left = centerX - size / 2;
  const top = centerY - size / 2;

  // Press scale (active only).
  const press = useRef(new Animated.Value(0)).current;
  const onPressIn = () => {
    if (!isActive) return;
    Animated.timing(press, {
      toValue: 1, duration: 120, useNativeDriver: true,
    }).start();
  };
  const onPressOut = () => {
    if (!isActive) return;
    Animated.timing(press, {
      toValue: 0, duration: 120, useNativeDriver: true,
    }).start();
  };
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });

  const borderColor =
    isCompleted ? GOLD
    : isActive ? accent
    : isInactive ? 'rgba(255,255,255,0.25)'
    : 'rgba(255,255,255,0.15)';

  const frameShadow = isActive
    ? styles.activeShadow
    : styles.baseShadow;

  return (
    <View
      style={[
        styles.wrapper,
        { left, top, width: size, height: size, opacity: isLocked ? 0.5 : 1 },
      ]}
      // Tiles never crop the badge (which overflows top-left).
      pointerEvents="box-none"
    >
      {/* Halo ring — active only. Renders behind the frame. */}
      {isActive ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              borderColor: accent,
              shadowColor: accent,
              opacity: press.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
            },
          ]}
        />
      ) : null}

      <Pressable
        disabled={!isActive}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={({ pressed }) => [
          { width: size, height: size, cursor: isActive ? 'pointer' : 'default' } as any,
        ]}
      >
        <Animated.View
          style={[
            styles.frame,
            frameShadow,
            {
              width: size,
              height: size,
              borderColor,
              transform: [{ scale }],
            },
          ]}
        >
          {poster ? (
            <Image
              source={{ uri: tmdb(poster) }}
              style={[
                styles.poster,
                // Desaturate completed via opacity only. RN has no CSS
                // sepia/saturate filter; the prior warm overlay clashed
                // with red CEFR borders. Locked tiles also dim so the
                // user can scan their reel ahead but the future still
                // reads as "not earned yet."
                isCompleted ? { opacity: 0.55 } : null,
                isLocked    ? { opacity: 0.28 } : null,
              ]}
              resizeMode="cover"
            ></Image>
          ) : (
            <View style={[styles.poster, { backgroundColor: FRAME_BG }]}></View>
          )}
          {/* Locked overlay — a thin dark wash on top of the dimmed
              poster so the future tiles read as "behind a veil," not
              just "low-contrast posters." */}
          {isLocked && poster ? (
            <View
              pointerEvents="none"
              style={[styles.poster, { backgroundColor: 'rgba(14,8,5,0.45)' }]}
            ></View>
          ) : null}

          {/* Bottom title strip — active + inactive only. */}
          {(isActive || isInactive) ? (
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.92)"]}
              style={[
                styles.titleStrip,
                isActive ? styles.titleStripActive : styles.titleStripInactive,
              ]}
              pointerEvents="none"
            >
              <Text
                numberOfLines={2}
                style={[
                  styles.titleText,
                  { fontSize: isActive ? 10 : 8.5 },
                ]}
              >
                {movie}
              </Text>
            </LinearGradient>
          ) : null}

          {/* Completed ✓ stamp — top-right. */}
          {isCompleted ? (
            <View style={styles.checkDisc} pointerEvents="none">
              <Text style={styles.checkGlyph}>✓</Text>
            </View>
          ) : null}

          {/* User-pick ★ stamp — top-left. Separate from the number
              badge so the user still sees queue position. Suppressed on
              locked tiles (the dimmed wrapper would mute the gold). */}
          {source === "user" && !isLocked ? (
            <View style={styles.starDisc} pointerEvents="none">
              <Text style={styles.starGlyph}>★</Text>
            </View>
          ) : null}
        </Animated.View>
      </Pressable>

      {/* Number badge — overflows the top-left. */}
      <View
        pointerEvents="none"
        style={[
          styles.badge,
          {
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: isCompleted ? GOLD : accent,
            opacity: isLocked ? 0.5 : 1,
          },
        ]}
      >
        <Text
          style={{
            color: isCompleted ? '#3a2400' : '#fff',
            fontSize: isActive ? 11 : 10,
            fontWeight: '900',
          }}
        >
          {badgeContent}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  halo: {
    position: 'absolute',
    top: -8, left: -8, right: -8, bottom: -8,
    borderWidth: 2,
    borderRadius: 12,
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
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
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  activeShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  titleStrip: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
  },
  titleStripActive: {
    paddingTop: 14, paddingBottom: 6, paddingHorizontal: 8,
  },
  titleStripInactive: {
    paddingTop: 8, paddingBottom: 4, paddingHorizontal: 6,
  },
  titleText: {
    color: '#fff',
    fontWeight: '800',
    lineHeight: Platform.OS === 'web' ? (10 * 1.15) : undefined,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  checkDisc: {
    position: 'absolute',
    top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  checkGlyph: {
    fontSize: 13, fontWeight: '900', color: '#3a2400',
  },
  starDisc: {
    position: 'absolute',
    top: 4, left: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  starGlyph: {
    fontSize: 11, fontWeight: '900', color: '#3a2400',
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

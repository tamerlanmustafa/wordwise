/**
 * MovieTile — a single film-cell on the Journey Reel. Every tile is
 * evergreen: same size, always tappable, no gating. The caller can
 * optionally pass `quizzed` to show a small ✓ stamp on movies the user
 * has completed at least one quiz session for.
 *
 * The tile is positioned by its parent at the tile's *center*
 * coordinates; this component sizes itself and centers within that
 * point.
 *
 * Light/dark: frame, fallback, badge stroke, and ✓ stamp pull from
 * useThemeColors(). The badge background tracks the quizzed state
 * (gold) or the CEFR colour (themed via the static CEFR table).
 */

import { useMemo, useRef } from 'react';
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
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

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
  /** v0.6 — backend-computed mastery status from UserMovieProgress.
   *  `mastered` swaps the ✓ for a "Final Cut" stamp; `studied` shifts
   *  the border to gold. `unstudied` (or undefined) renders as before. */
  status?: 'unstudied' | 'studied' | 'mastered';
  /** v0.6 — frequency-weighted % of the movie's vocab the user knows
   *  (0..100). Surfaced as a small chip bottom-left when > 0. */
  comprehensibilityPercent?: number;
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
  status,
  comprehensibilityPercent,
  busy,
  onPress,
}: MovieTileProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // `studied` shifts the border to gold; `mastered` keeps gold + adds a
  // film-stamp overlay. Falls back to the CEFR color otherwise.
  const accent =
    status === 'studied' || status === 'mastered'
      ? tc.gold
      : CEFR_COLOR[level] ?? CEFR_COLOR.A1;
  const left = centerX - TILE_SIZE / 2;
  const top = centerY - TILE_SIZE / 2;
  const showPctChip =
    typeof comprehensibilityPercent === 'number' && comprehensibilityPercent >= 1;

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
        s.wrapper,
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
            s.frame,
            s.baseShadow,
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
              style={s.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={[s.poster, { backgroundColor: tc.reelStockDeep }]} />
          )}

          {/* Bottom title strip — always visible now that every tile is
              first-class. */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.92)']}
            style={s.titleStrip}
            pointerEvents="none"
          >
            <Text numberOfLines={2} style={s.titleText}>
              {movie}
            </Text>
          </LinearGradient>

          {/* Top-right stamp. Priority: Final Cut (mastered) > ✓ (any
              completed quiz session). Both are bright on a dark tile so
              they read without a backdrop. */}
          {status === 'mastered' ? (
            <View style={s.finalCutStamp} pointerEvents="none">
              <Text style={s.finalCutText}>FINAL{'\n'}CUT</Text>
            </View>
          ) : quizzed ? (
            <View style={s.checkDisc} pointerEvents="none">
              <Text style={s.checkGlyph}>✓</Text>
            </View>
          ) : null}

          {/* Bottom-left comprehensibility chip — only when nonzero so
              an unstudied tile doesn't get a "0%" badge. */}
          {showPctChip ? (
            <View style={s.pctChip} pointerEvents="none">
              <Text style={s.pctChipText}>
                {Math.round(comprehensibilityPercent!)}%
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </Pressable>

      {/* Number badge — overflows top-left. Shows queue position. */}
      <View
        pointerEvents="none"
        style={[
          s.badge,
          {
            width: BADGE_SIZE,
            height: BADGE_SIZE,
            borderRadius: BADGE_SIZE / 2,
            backgroundColor: quizzed ? tc.gold : accent,
          },
        ]}
      >
        <Text
          style={{
            color: quizzed ? tc.goldDeep : tc.textInverse,
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

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  frame: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: tc.reelStockDeep,
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
    backgroundColor: tc.gold,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  checkGlyph: {
    fontSize: 12, fontWeight: '900', color: tc.goldDeep,
  },
  finalCutStamp: {
    position: 'absolute',
    top: 4, right: 4,
    paddingHorizontal: 4, paddingVertical: 2,
    backgroundColor: tc.gold,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: tc.goldDeep,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  finalCutText: {
    fontSize: 7,
    fontWeight: '900',
    color: tc.goldDeep,
    letterSpacing: 0.4,
    textAlign: 'center',
    lineHeight: 8,
  },
  pctChip: {
    position: 'absolute',
    left: 4, bottom: 22,  // sit above the title strip
    paddingHorizontal: 5, paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 6,
  },
  pctChipText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.2,
  },
  badge: {
    position: 'absolute',
    top: -8, left: -4,
    borderWidth: 2.5,
    borderColor: tc.reelStock,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});

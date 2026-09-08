/**
 * PracticeTile — v0.7.3 Practice-tab tile (Duolingo-style path).
 *
 * One pressable coin. Four visual states, derived by the parent path
 * component from the cursor:
 *
 *   • active    → gold coin, bare face, and a gentle bounce. Tappable, and
 *                 exactly one per render. (= cursor position)
 *   • completed → green coin, slightly receded. Past tiles.
 *   • locked    → matte stone coin. Future tiles — unlocked by walking the
 *                 path to them.
 *   • repair    → red coin, alarm glyph.
 *                 (Reserved — pseudo-tile injected when
 *                 repair_window_active. Not yet implemented as a
 *                 real tappable flow; v1 just renders the visual.)
 *
 * **Colour is still the state.** A done tile is green, the next one is gold
 * and moving, and the rest are stone; you can read the whole path with the
 * marks turned off. What the marks add is a second, much quieter channel —
 * a groove cut into the tread rather than a badge printed on it, at opacities
 * chosen so the road ahead recedes rather than announcing itself. That is why
 * they are not the check-and-callout set that was removed here once: those
 * were flat glyphs restating the colour at full contrast, and these are
 * surface texture that happens to carry a meaning.
 *
 * The one flat glyph left is the alarm on `repair`, which is a genuine
 * interruption rather than a position on the path.
 *
 * The body lives in {@link TilePill}, the marks in {@link TileMarks} and the
 * impact mark in {@link TileCrack}; this file owns the state → colour mapping
 * and the animations.
 *
 * The active tile hovers until it is tapped. Tapping lands it: the bounce
 * stops where it is, the face sinks onto its edge, and a fan of fissures
 * spreads from under it. The ring of dots that used to turn around it is gone
 * — the bounce already marks the one tappable tile, and a second permanent
 * animation on the same object was two things competing to say one thing.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { TILE_BLOCK, TILE_W, GLYPH_BOX, TilePill } from './TilePill';
import { TileCrack } from './TileCrack';
import { TileMarks, type MarkSide } from './TileMarks';
import { tileVisual, tileMark } from './tileVisuals';

export type PracticeTileState =
  | 'active'
  | 'completed'
  | 'locked'
  | 'repair';

export interface PracticeTileProps {
  state: PracticeTileState;
  onPress?: () => void;
  /** Which side of the tread a completed tile cuts its check into. Alternates
   *  down the path so nine checks don't draw a stripe the road doesn't have. */
  markSide?: MarkSide;
  /** The one locked tile directly above the active one. Its lock is cut a
   *  little deeper than the rest of the road ahead. */
  nextUp?: boolean;
  /** 0–1 dial on the stair depth cues — see {@link TilePill}. */
  depth?: number;
  /** When false, only `nextUp` carries a lock. */
  marksOnAllLocked?: boolean;
}

export function PracticeTile({
  state,
  onPress,
  markSide = 'right',
  nextUp = false,
  depth = 1,
  marksOnAllLocked = true,
}: PracticeTileProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);

  // Active-state gentle bounce — draws the eye to the one tappable tile
  // and reads as "this is your next step forward". Pauses for every
  // other state so the rest of the path stays calm.
  //
  // It runs until the tile is struck and then never again for this mount: the
  // tap is a commitment, and a tile that keeps hovering after you have chosen
  // it is still asking to be chosen.
  const bounce = useRef(new Animated.Value(0)).current;
  const [struck, setStruck] = useState(false);
  useEffect(() => {
    if (state !== 'active' || struck) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => {
      anim.stop();
    };
  }, [state, struck, bounce]);

  // The landing. The loop above has already been torn down by `struck`, so
  // this only has to bring the tile down from wherever it stopped and open
  // the crack under it.
  const crack = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!struck) return;
    Animated.parallel([
      Animated.timing(bounce, {
        toValue: 0,
        duration: 110,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(crack, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [struck, bounce, crack]);
  const translateY = bounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  const tappable = state === 'active';

  // The tile's entire vocabulary — kept pure and tested in `tileVisuals`,
  // because colour is what tells the user where on the path they are and the
  // marks only whisper it a second time.
  const visual = tileVisual(state, tc);
  const mark = tileMark(state, { nextUp, marksOnAllLocked });

  return (
    <Pressable
      onPress={tappable ? onPress : undefined}
      // On press-in, not on press: the mark belongs to the finger landing,
      // and `onPress` fires on release — by which time the navigation this
      // tile starts is already under way and there is nothing left to watch.
      onPressIn={tappable ? () => setStruck(true) : undefined}
      style={s.hit}
      hitSlop={8}
    >
      {({ pressed }) => (
        <View style={s.stack}>
          {struck ? <TileCrack progress={crack} /> : null}

          {/* Face and edge move as one unit so the bounce never splits the
              tile apart; pressing sinks only the face onto its edge. */}
          <Animated.View
            style={[
              visual.faded && s.receded,
              state === 'active' && { transform: [{ translateY }] },
            ]}
          >
            <TilePill
              face={visual.face}
              edge={visual.edge}
              band={visual.band}
              nosing={visual.nosing}
              depth={depth}
              pressed={pressed && tappable}
            >
              {visual.glyph ? <TileGlyph kind={visual.glyph} color="#fff" /> : null}
              <TileMarks mark={mark} side={markSide} nextUp={nextUp} />
            </TilePill>
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
}

type TileGlyphKind = 'alarm';

/** Its own <Svg> now, and an ordinary child of the face view: the face is two
 *  plain views rather than an SVG group, so it sinks on press by carrying its
 *  children with it.
 *
 *  One kind left, and it is the one that is genuinely *on* the tile rather
 *  than in it: an alarm is an alert, and an alert that has been sanded into
 *  the stone is not alerting anyone. Everything a tile says about its position
 *  on the path is a groove instead — see {@link TileMarks}. */
function TileGlyph({
  kind,
  color,
}: {
  kind: TileGlyphKind;
  color: string;
}) {
  const p = {
    fill: 'none',
    stroke: color,
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind !== 'alarm') return null;
  return (
    <Svg width={GLYPH_BOX} height={GLYPH_BOX} viewBox="0 0 24 24">
      <Path {...p} d="M12 8v4l3 2M4 5l3-2M20 5l-3-2" />
      <Path {...p} d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
    </Svg>
  );
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    hit: {
      alignItems: 'center',
    },
    // Exactly one tile. The crack overflows it on both sides deliberately —
    // reserving space for it would widen every row for a mark that only one
    // tile ever shows, and it is pointer-transparent, so the overflow costs
    // nothing but pixels.
    stack: {
      width: TILE_W,
      height: TILE_BLOCK,
      alignItems: 'center',
    },
    receded: {
      opacity: 0.9,
    },
  });

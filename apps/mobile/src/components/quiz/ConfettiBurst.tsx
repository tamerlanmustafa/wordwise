/**
 * ConfettiBurst — the burst over the session-complete beat.
 *
 * Named `ConfettiBurst` rather than `Confetti` because its data module is
 * `confetti.ts`, and on a case-insensitive filesystem (every Mac by default)
 * `Confetti.tsx` and `confetti.ts` are the same path — the import resolved to
 * the data file and TypeScript reported a missing export that was plainly
 * there.
 *
 * Geometry comes from `./confetti` as plain data so it is testable and, more
 * importantly, *stable*: generating pieces during render would give each one
 * new coordinates on every commit, and the confetti would teleport instead of
 * falling.
 *
 * Every piece animates one shared 0→1 value through interpolations —
 * translateY, translateX, rotate, opacity — so the whole burst is one native
 * animation per piece and nothing touches the JS thread mid-fall. Sixty-four
 * views is a lot to have on screen; they are all `pointerEvents: none` and
 * unmount with the beat.
 *
 * Skipped entirely under reduced motion. Falling debris is the single most
 * motion-sick-inducing thing in the app, and the celebration still reads from
 * the disc, the rings and the copy.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useThemeColors } from '../../theme/tokens';
import { confettiPieces, type ConfettiPiece } from './confetti';
import { useReducedMotion } from './quizMotion';

function Piece({
  piece,
  color,
  height,
  width,
}: {
  piece: ConfettiPiece;
  color: string;
  height: number;
  width: number;
}) {
  const fall = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(fall, {
      toValue: 1,
      duration: piece.duration,
      delay: piece.delay,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [fall, piece.duration, piece.delay]);

  const h = piece.width / piece.aspect;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        // `start`, not `left`: an absolute physical offset does not mirror
        // under RTL, and confetti that only ever falls down the same side of
        // an Arabic screen is a bug the guard catches before a human does.
        start: piece.x * width,
        // Starts above the top edge so pieces enter rather than appear.
        top: -20,
        width: piece.width,
        height: h,
        borderRadius: piece.aspect === 1 ? piece.width : 1,
        backgroundColor: color,
        opacity: fall.interpolate({
          inputRange: [0, 0.07, 0.9, 1],
          outputRange: [0, 1, 1, 0],
        }),
        transform: [
          {
            translateY: fall.interpolate({
              inputRange: [0, 1],
              outputRange: [0, height + 40],
            }),
          },
          {
            translateX: fall.interpolate({
              inputRange: [0, 1],
              outputRange: [0, piece.drift],
            }),
          },
          {
            rotate: fall.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', `${piece.spin}deg`],
            }),
          },
        ],
      }}
    />
  );
}

export function ConfettiBurst() {
  const tc = useThemeColors();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pieces = useMemo(() => confettiPieces(), []);

  // A mix of the app's accents plus two festive one-offs, so the burst is not
  // a monochrome gold shower.
  const palette = useMemo(
    () => [tc.gold, tc.confettiViolet, tc.success, tc.confettiCoral, tc.confettiCream],
    [tc.gold, tc.success, tc.confettiViolet, tc.confettiCoral, tc.confettiCream],
  );

  if (reduced.current) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((piece, i) => (
        <Piece
          key={i}
          piece={piece}
          color={palette[piece.colorIndex % palette.length]}
          width={width}
          height={height}
        />
      ))}
    </View>
  );
}

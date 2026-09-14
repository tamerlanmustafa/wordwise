/**
 * BackToStartButton — the way back to the active tile once it has scrolled
 * out of sight.
 *
 * The path scrolls a long way in both directions from where it opens: thirty
 * tiles of road ahead, and up to thirty of history below. Past a screen or two
 * the gold START tile is gone and nothing says which way it went, so this
 * appears on the edge the tile left by — at the top pointing up when the user
 * has scrolled down into their history, at the bottom pointing down when they
 * have climbed the road ahead — and scrolls back to it.
 *
 * Fades rather than popping, and keeps its last side while fading out, so a
 * tile scrolling back into view does not make the button jump to the other
 * edge on its way out.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { PressablePill } from '../ui/PressablePill';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { withTap } from '../../utils/feedback';
import type { TileSide } from './pathCentering';

/** The face's diameter: the platform's minimum comfortable touch target. */
const SIZE = 44;
/** Gap between the button and the edge of the path it sits on. */
const INSET = 12;

interface Props {
  side: TileSide;
  onPress: () => void;
  /** The bottom bar's reserved height — the lower button sits above it. */
  bottomOffset: number;
}

export function BackToStartButton({ side, onPress, bottomOffset }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // The side to draw on: the live one while there is one, and the last one
  // through the fade-out (see the docblock).
  const [lastSide, setLastSide] = useState<'above' | 'below'>('below');
  useEffect(() => {
    if (side) setLastSide(side);
  }, [side]);
  const placed = side ?? lastSide;

  const shown = useRef(new Animated.Value(side ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(shown, {
      toValue: side ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [side, shown]);

  const up = placed === 'above';
  return (
    <Animated.View
      pointerEvents={side ? 'box-none' : 'none'}
      style={[
        s.slot,
        up ? { top: INSET } : { bottom: bottomOffset + INSET },
        {
          opacity: shown,
          transform: [
            {
              // A short slide from the edge it belongs to, so the direction
              // reads before the arrow does.
              translateY: shown.interpolate({
                inputRange: [0, 1],
                outputRange: [up ? -8 : 8, 0],
              }),
            },
          ],
        },
      ]}
    >
      <PressablePill
        edge={tc.border}
        radius={SIZE / 2}
        faceStyle={s.face}
        onPress={withTap(onPress)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('practice:backToStart')}
      >
        <Ionicons name={up ? 'chevron-up' : 'chevron-down'} size={22} color={tc.goldOnSurface} />
      </PressablePill>
    </Animated.View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    slot: {
      position: 'absolute',
      end: 18,
    },
    face: {
      width: SIZE,
      height: SIZE,
      borderRadius: SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
  });

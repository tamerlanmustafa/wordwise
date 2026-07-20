import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useColorScheme } from '../../theme/tokens';

/**
 * FilmEdgeBackdrop — pure screen decoration for the Ledger card screen:
 * a warm radial glow anchored top-center plus two 8px sprocket-dot strips
 * flush to the left and right edges (the film-stock metaphor the practice
 * reel already uses). Everything is pointerEvents="none".
 */

const GLOW_WIDTH = 520;
const GLOW_HEIGHT = 340;
/** Sprocket tile: one 4px dot per 18px of strip height. */
const DOT_TILE = 18;
const DOT_SIZE = 4;

interface Props {
  /** Where the strips start — just below the header. */
  topOffset: number;
}

export const FilmEdgeBackdrop = ({ topOffset }: Props) => {
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme();

  // The glow keeps the gold family per scheme; dots are near-invisible
  // texture, slightly brighter in dark mode to survive the dark ground.
  const glowColor = scheme === 'dark' ? '#FFD166' : '#C58B1B';
  const glowOpacity = scheme === 'dark' ? 0.18 : 0.16;
  const dotColor = scheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(91,68,34,0.10)';

  const dotCount = Math.max(0, Math.ceil((height - topOffset - 16) / DOT_TILE));
  const dots = useMemo(() => Array.from({ length: dotCount }, (_, i) => i), [dotCount]);

  const strip = (side: 'left' | 'right') => (
    <View
      pointerEvents="none"
      style={[styles.strip, { top: topOffset }, side === 'left' ? { left: 6 } : { right: 6 }]}
    >
      {dots.map((i) => (
        <View key={i} style={[styles.dot, { backgroundColor: dotColor }]} />
      ))}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width={GLOW_WIDTH}
        height={GLOW_HEIGHT}
        style={[styles.glow, { left: (width - GLOW_WIDTH) / 2 }]}
      >
        <Defs>
          <RadialGradient id="ledgerGlow" cx="50%" cy="0%" rx="50%" ry="100%">
            <Stop offset="0%" stopColor={glowColor} stopOpacity={glowOpacity} />
            <Stop offset="65%" stopColor={glowColor} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={GLOW_WIDTH} height={GLOW_HEIGHT} fill="url(#ledgerGlow)" />
      </Svg>
      {strip('left')}
      {strip('right')}
    </View>
  );
};

const styles = StyleSheet.create({
  glow: {
    position: 'absolute',
    top: -70,
  },
  strip: {
    position: 'absolute',
    bottom: 16,
    width: 8,
    alignItems: 'center',
    overflow: 'hidden',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginBottom: DOT_TILE - DOT_SIZE,
  },
});

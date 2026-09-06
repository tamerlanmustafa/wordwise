/**
 * TileCrack — the mark the active tile leaves in the floor when you press it.
 *
 * The tile bounces until it is tapped. Tapping stops the bounce and lands it,
 * and this is what the landing does to the ground underneath: a short fan of
 * fissures spreading from the point of impact. It is press feedback with a
 * story — the tile was hovering, you put it down, and the floor took it.
 *
 * ## Drawn under the tile, not on it
 *
 * It is a sibling rendered *before* the coin and anchored to the bottom of the
 * coin's block, so the tile's own body covers the origin of every line and
 * only the parts that escape the silhouette are visible. That is what makes
 * the fissures read as coming out from under the tile rather than as a
 * decoration lying beside it.
 *
 * ## Ink
 *
 * `text` at low alpha rather than a fixed dark. On the light theme that is a
 * dark crack in a pale floor, which is the literal reading; on the dark theme
 * it inverts to a bright fissure, which is the same idea lit from below and
 * the only version that is visible at all on a near-black ground. A fixed
 * dark ink would simply disappear there.
 *
 * Opacity and scale only, so the whole thing runs on the native driver and
 * does not compete with the navigation that a tap on this tile starts.
 */

import { Animated, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, withAlpha } from '../../theme/tokens';

/** Painted width. Wider than the tile, since the fissures outrun it. */
export const CRACK_W = 104;
/** Painted height, measured down from the tile's baseline. */
export const CRACK_H = 26;

/**
 * The fissures, as one path per line, fanning from the centre top.
 *
 * Hand-plotted rather than generated: a random fan is a different mark on
 * every tile, and this one is a fixed drawing that happens to look random.
 * Every line starts near (52, 0) — under the tile — and every line has one
 * kink, because a crack that runs straight reads as a scratch.
 */
const FISSURES: readonly string[] = [
  'M52 2 L38 10 L26 12',
  'M52 2 L44 13 L40 22',
  'M52 2 L56 12 L52 21',
  'M52 2 L64 11 L74 14',
  'M52 2 L60 8 L78 8',
  'M52 2 L42 7 L28 5',
];

export function TileCrack({ progress }: { progress: Animated.Value }) {
  const tc = useThemeColors();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          opacity: progress,
          // Spreads outward from the point of impact rather than appearing at
          // full width, which would read as a texture switching on.
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
          ],
        },
      ]}
    >
      <Svg width={CRACK_W} height={CRACK_H}>
        {FISSURES.map((d) => (
          <Path
            key={d}
            d={d}
            stroke={withAlpha(tc.text, 0.34)}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    // Anchored to the coin's baseline: the fan starts where the tile lands.
    bottom: 0,
    alignItems: 'center',
  },
});

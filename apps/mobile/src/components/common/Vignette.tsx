/**
 * Vignette — darkened top and bottom edges, over whatever is behind them.
 *
 * Shared by the search overlay and by every BottomSheet's scrim, so a screen
 * that has gone "behind something" looks the same whichever thing it is
 * behind. A flat scrim dims content evenly and reads as a grey sheet; pulling
 * the edges down further reads as depth, and puts the eye where the live
 * control is rather than in a corner.
 *
 * `expo-linear-gradient` has no radial mode, so this is two vertical gradients
 * rather than a true corner vignette. On a phone the vertical axis is most of
 * what a vignette reads as anyway — adding the two horizontal edges would cost
 * two more layers to darken about 30pt of gutter nobody looks at.
 *
 * Never takes a touch: it is drawn over the scrim that owns the dismissal, and
 * a decoration that eats that tap would leave the sheet with no way out.
 */

import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/** How far the gradients reach in from each edge. */
export const VIGNETTE_HEIGHT = 160;

export function Vignette({ color }: { color: string }) {
  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={[color, 'transparent']}
        style={[styles.band, styles.top]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', color]}
        style={[styles.band, styles.bottom]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    start: 0,
    end: 0,
    height: VIGNETTE_HEIGHT,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});

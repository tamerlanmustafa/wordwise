/**
 * FocusWash — everything painted before this recedes; everything after it is
 * the subject.
 *
 * A dim plus a vignette, permanently on and never interactive. The sibling of
 * `SearchDimOverlay`, and the distinction between them is the whole reason
 * this is a separate component rather than a prop on that one:
 *
 *   SearchDimOverlay is *modal*. It appears because the user did something, it
 *   fades, it swallows taps, and the dim is a promise that what is underneath
 *   cannot be reached.
 *
 *   FocusWash is *ambient*. Nothing is covering anything. The screen is simply
 *   telling you which part of it is the point, and everything under it stays
 *   legible, tappable and clearly present — a back button buried under a modal
 *   scrim is a bug, and this one has to stay findable.
 *
 * Both read `dimColors` so the two depths are decided in one place, and both
 * use the shared `Vignette`, so a screen that has receded looks the same
 * whichever reason it receded for.
 *
 * ## How to place it
 *
 * There is no `zIndex` here on purpose. It covers exactly what was drawn
 * before it and nothing drawn after, so its position in the JSX *is* the
 * configuration — put it directly after the last thing that should recede.
 * A zIndex would let it be dropped anywhere and then need a second number to
 * say what it meant, which is how two elements end up fighting over an order
 * neither file states.
 *
 * `pointerEvents="none"` throughout: this is decoration over live controls,
 * and a decoration that eats a tap is worse than no decoration.
 */

import { StyleSheet, View } from 'react-native';
import { useColorScheme } from '../../theme/tokens';
import { Vignette } from './Vignette';
import { dimColors } from '../../theme/dim';

/**
 * How far the darkening reaches in from each edge.
 *
 * Deeper than a sheet scrim's atmosphere, because this one has a job: the film
 * hero it has to push back runs to roughly 206pt on a notched phone — safe
 * area, the back row, then the poster's own 100. At the shared 160 the
 * poster's lower half sat outside the dark part and stayed bright, which is
 * the whole complaint the number exists to answer.
 */
const REACH = 260;

export function FocusWash() {
  const scheme = useColorScheme();
  const { base, edge } = dimColors('ambient', scheme);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: base }]} />
      <Vignette color={edge} height={REACH} />
    </View>
  );
}

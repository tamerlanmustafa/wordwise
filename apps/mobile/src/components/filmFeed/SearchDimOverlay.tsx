/**
 * SearchDimOverlay — what the rest of the screen does while you are searching.
 *
 * Focusing the field puts the app in a mode, and the screen should say so. The
 * feed dims and the edges darken, so the field and its panel are the only
 * things at full strength and the eye has one place to be.
 *
 * It is also the hit target that closes the panel: the same overlay that makes
 * the feed look inactive makes it actually inactive, which is the honest
 * pairing. A dim that still let a tap through to a film card would be worse
 * than no dim at all, because it would look unavailable and behave otherwise.
 *
 * ## No real blur, deliberately
 *
 * A true background blur needs `expo-blur`, which is a native module this app
 * does not ship — adding it means a full `eas build` rather than an over-the-
 * air update, so it cannot arrive with the rest of this. What is here is a
 * dim plus a vignette, which is the part of the effect that carries the
 * meaning (that content is behind something). Swapping in `<BlurView>` behind
 * these layers is a small change whenever a native build next goes out.
 *
 * The vignette itself is `common/Vignette`, shared with every BottomSheet's
 * scrim so a screen that has gone behind something looks the same whichever
 * thing it is behind.
 *
 * Opacity is the only animated property, so this runs on the native driver and
 * does not compete with the keyboard animation it arrives alongside.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '../../theme/tokens';
import { Vignette } from '../common/Vignette';
import { dimColors } from '../../theme/dim';

const FADE_IN_MS = 220;
const FADE_OUT_MS = 160;

export function SearchDimOverlay({
  active,
  onPress,
}: {
  active: boolean;
  /** Dismisses the search. The overlay exists as much for this as for the
   *  dimming — see the note above. */
  onPress: () => void;
}) {
  const scheme = useColorScheme();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: active ? 1 : 0,
      // Out faster than in: dismissing should feel immediate, and a slow fade
      // on the way out reads as lag rather than as polish.
      duration: active ? FADE_IN_MS : FADE_OUT_MS,
      useNativeDriver: true,
    }).start();
  }, [active, fade]);

  // Modal weight: the panel is over the feed and the feed is unreachable, so
  // the dim is also the promise that a tap lands here rather than on a film
  // card. Both values were raised once seen on a device — the first pass
  // dimmed enough to notice and not enough to stop the feed competing.
  const { base, edge } = dimColors('modal', scheme);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, styles.layer, { opacity: fade }]}
      // Never intercepts a touch while it is invisible. Always-mounted plus a
      // toggled pointerEvents is what lets it fade out — unmounting on the
      // frame focus is lost would make it disappear rather than settle.
      pointerEvents={active ? 'auto' : 'none'}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Close search"
      />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: base }]}
      />
      <Vignette color={edge} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    // Over the feed (0), under the header (10) — the field and its panel stay
    // at full strength and stay tappable.
    zIndex: 5,
  },
});

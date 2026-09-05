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
 * ## The vignette
 *
 * `expo-linear-gradient` has no radial mode, so the vignette is two vertical
 * gradients — one darkening down from the top edge, one darkening up from the
 * bottom — over a flat base tint. On a tall phone screen the vertical axis is
 * most of what a vignette reads as anyway; adding the two horizontal edges
 * costs two more layers to darken 30pt of gutter nobody is looking at.
 *
 * Opacity is the only animated property, so this runs on the native driver and
 * does not compete with the keyboard animation it arrives alongside.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '../../theme/tokens';

const FADE_IN_MS = 220;
const FADE_OUT_MS = 160;

/** How far the edge gradients reach in from the top and bottom. */
const VIGNETTE_HEIGHT = 160;

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

  // Light mode needs a lighter hand — the same alpha that reads as "behind
  // something" on a dark ground reads as "broken" on a pale one.
  const base = scheme === 'dark' ? 'rgba(0,0,0,0.46)' : 'rgba(20,16,10,0.26)';
  const edge = scheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(20,16,10,0.30)';

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
      <LinearGradient
        pointerEvents="none"
        colors={[edge, 'transparent']}
        style={[styles.vignette, styles.vignetteTop]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', edge]}
        style={[styles.vignette, styles.vignetteBottom]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    // Over the feed (0), under the header (10) — the field and its panel stay
    // at full strength and stay tappable.
    zIndex: 5,
  },
  vignette: {
    position: 'absolute',
    start: 0,
    end: 0,
    height: VIGNETTE_HEIGHT,
  },
  vignetteTop: {
    top: 0,
  },
  vignetteBottom: {
    bottom: 0,
  },
});

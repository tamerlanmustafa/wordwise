/**
 * SwipeBackView — interactive edge-swipe back gesture for the deep-screen layer.
 *
 * Dragging in from the leading screen edge pulls the current screen aside; past
 * the threshold it keeps going and fires `onBack`, otherwise it springs home.
 * This is the gesture users expect from every other app, and the app had no
 * equivalent: navigation is a single flat `currentScreen` string rather than a
 * react-navigation stack, so nothing was providing it for free.
 *
 * Built on PanResponder + Animated rather than a native gesture library for the
 * same reason SwipeableRow is — no new native module means the change ships as
 * an OTA update instead of a store build.
 *
 * Two details worth keeping:
 *
 *   • The gesture is claimed in the *bubble* phase and only for touches that
 *     began within `EDGE_ZONE_WIDTH` of the leading edge. Anything that starts
 *     mid-screen reaches the child first, so the word-card deck, the mix bar and
 *     the feed rows keep their own horizontal drags.
 *
 *   • On commit the screen is left translated off-screen and reset during the
 *     *next render*, when `screenKey` changes. Resetting in the animation
 *     callback instead would snap the outgoing screen back to centre for the one
 *     frame before React re-renders — the same ordering trap SwipeableRow
 *     documents for recycled rows.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { directionSign, isRTL } from '../../i18n/rtl';
import {
  edgeSwipeCommits,
  leadingEdgeDistance,
  shouldClaimEdgeSwipe,
} from '../../utils/edgeSwipeBack';

interface Props {
  children: ReactNode;
  /**
   * Where back goes from the screen currently rendered, or null when it has
   * nowhere to go — the gesture is inert rather than sliding to a dead end.
   */
  onBack: (() => void) | null;
  /**
   * Identity of the screen being shown. A change means navigation happened, and
   * is what snaps the drag offset back to zero before the new screen paints.
   */
  screenKey: string;
}

/** How long the screen takes to finish leaving once the swipe commits. */
const COMMIT_MS = 190;

export function SwipeBackView({ children, onBack, screenKey }: Props) {
  const { width } = useWindowDimensions();

  // Logical drag offset: 0 at rest, growing toward the trailing edge. Converted
  // to physical pixels only in the transform, so RTL flips for free.
  const translate = useRef(new Animated.Value(0)).current;
  const translateX = useMemo(() => Animated.multiply(translate, directionSign), [translate]);

  // Read inside the responder, which is memoized for the life of the mount and
  // must not close over a stale handler.
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const widthRef = useRef(width);
  widthRef.current = width;

  // Navigation happened — put the screen back at rest before it paints. During
  // render on purpose (see the header note); writing to a ref-held
  // Animated.Value is not React state, so there is nothing to loop on.
  const shownKey = useRef(screenKey);
  if (shownKey.current !== screenKey) {
    shownKey.current = screenKey;
    translate.stopAnimation();
    translate.setValue(0);
  }

  // On a root tab the deep-screen layer renders nothing and the live tab shows
  // through from the KeepAlive layer underneath, so the host stands down rather
  // than laying an inert full-screen View over it. Computed here, acted on after
  // the last hook — an early return above one would break the hook order.
  const empty = children == null;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Taps must reach the screen, so the responder is only ever claimed on
        // movement, never on touch-down.
        onMoveShouldSetPanResponder: (_e, g) => {
          if (!onBackRef.current) return false;
          // `moveX - dx` reconstructs where the finger went down; PanResponder
          // does not report the start position on its own.
          const startX = leadingEdgeDistance(g.moveX - g.dx, widthRef.current, isRTL());
          return shouldClaimEdgeSwipe(startX, g.dx * directionSign, g.dy);
        },
        // Once the screen is following the finger, a bit of vertical drift must
        // not hand the gesture back to a scroll view underneath.
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          // Clamped at 0: dragging back past the start should not push the
          // screen off the other edge.
          translate.setValue(Math.max(0, g.dx * directionSign));
        },
        onPanResponderRelease: (_e, g) => {
          const dx = g.dx * directionSign;
          const vx = g.vx * directionSign;
          if (!onBackRef.current || !edgeSwipeCommits(dx, vx, widthRef.current)) {
            Animated.spring(translate, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
              speed: 14,
            }).start();
            return;
          }
          Animated.timing(translate, {
            toValue: widthRef.current,
            duration: COMMIT_MS,
            useNativeDriver: true,
          }).start(() => {
            const back = onBackRef.current;
            back?.();
            // Failsafe: if that back handler did not actually change the
            // screen, the offset would strand this screen off-canvas. The
            // render-time reset above clears `shownKey` first when navigation
            // did happen, so this only fires in the degenerate case.
            setTimeout(() => {
              if (shownKey.current === screenKey) translate.setValue(0);
            }, 0);
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [translate, screenKey],
  );

  if (empty) return null;

  // Nothing is painted behind the sliding screen on purpose: the drag uncovers
  // whatever the app layers under this one — the tab layer, or App's themed
  // root background. A backdrop of our own here would sit *over* the tab layer
  // and hide it.
  return (
    <View style={styles.fill} {...pan.panHandlers}>
      <Animated.View style={[styles.fill, { transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

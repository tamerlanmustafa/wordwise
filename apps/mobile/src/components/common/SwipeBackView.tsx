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
 *   • On commit the screen is left translated off-screen and reset when
 *     `screenKey` changes — in a LAYOUT EFFECT, so the reset lands in the same
 *     frame as the style that acts on it. Both of the other two places this
 *     could go are wrong, and each was tried: the animation callback snaps the
 *     outgoing screen back to centre for the frames before React re-renders
 *     (the ordering trap SwipeableRow documents for recycled rows), and the
 *     render phase snaps it back for the frames before React *commits*, which
 *     under concurrent rendering measured 39ms. See the effect for the trace.
 */

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
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
  /**
   * Whether this layer is showing a screen right now.
   *
   * Defaults to "there are children", which is the honest answer for a host
   * whose children come and go with the screen. A host that KEEPS a hidden
   * screen mounted inside it — the movie detail, so a tab detour doesn't
   * remount and refetch it — has to say so, because its children outlive the
   * screen on top of them and can no longer answer the question.
   */
  showing?: boolean;
}

/** How long the screen takes to finish leaving once the swipe commits. */
const COMMIT_MS = 190;

export function SwipeBackView({ children, onBack, screenKey, showing }: Props) {
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

  // Mirrors the prop for the responder's failsafe below, which runs on a timer
  // and must be able to tell "navigation happened" from "it didn't" *before*
  // the commit lands. Same shape as `onBackRef` / `widthRef` above.
  const latestKey = useRef(screenKey);
  latestKey.current = screenKey;

  /**
   * Navigation happened — put the drag offset back to rest.
   *
   * In a LAYOUT EFFECT, which is the whole point: it runs after React has
   * committed this render and before the frame is drawn, so the reset lands in
   * the same frame as the style that acts on it.
   *
   * This used to run during render, and that was a real bug rather than a
   * style preference. On a committed swipe the outgoing screen sits at
   * `translate = width` (off-screen) and the same render both snaps it back to
   * 0 and marks the host `display:none` — but only the first of those takes
   * effect during render. Writing an Animated.Value is an immediate native
   * side effect; `display:none` waits for the commit. Under concurrent React
   * those are not the same tick, and measured on device they were **39ms
   * apart**:
   *
   *     +680ms  translate=402   (off-screen, animation finished)
   *     +683ms  reset in render
   *     +684ms  translate=0     ← centred again, and still visible
   *     +723ms  commit          ← display:none finally applied
   *
   * so the film you had just swiped away flashed back over the feed for two or
   * three frames. The render-phase write was also being executed twice per
   * navigation, which is what a side effect in render gets you.
   */
  const shownKey = useRef(screenKey);
  useLayoutEffect(() => {
    if (shownKey.current === screenKey) return;
    shownKey.current = screenKey;
    translate.stopAnimation();
    translate.setValue(0);
  }, [screenKey, translate]);

  // On a root tab the deep-screen layer renders nothing and the live tab shows
  // through from the KeepAlive layer underneath, so the host stands down rather
  // than laying an inert full-screen View over it. Computed here, acted on after
  // the last hook — an early return above one would break the hook order.
  const empty = showing != null ? !showing : children == null;

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
            // screen, the offset would strand this screen off-canvas.
            //
            // It asks `latestKey`, not `shownKey`. `shownKey` is only updated
            // once the commit lands, and this timer can easily beat the commit
            // — measured at 39ms behind — so reading it here would see a
            // screen that had in fact navigated, snap a still-visible view
            // back to centre, and reintroduce exactly the flash the layout
            // effect above exists to remove. `latestKey` mirrors the prop, so
            // it is already correct by the time React has rendered.
            setTimeout(() => {
              if (latestKey.current === screenKey) translate.setValue(0);
            }, 0);
          });
        },
        onPanResponderTerminate: () => {
          Animated.spring(translate, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        },
      }),
    [translate, screenKey],
  );

  // With nothing mounted there is nothing to preserve, so the host leaves the
  // tree entirely — exactly as it always has.
  if (children == null) return null;

  // ONE tree, styled two ways. This must not become two `return`s with
  // different shapes: React reconciles by position and type, so a hidden
  // branch that dropped the Animated.View would make the screen underneath it
  // a different child than the shown branch's — and React would unmount and
  // remount the whole subtree on every toggle. That is a silent bug, because
  // the result looks exactly like a working screen; it just rebuilds its state
  // from scratch each time, which is the one thing keeping it mounted exists
  // to prevent.
  //
  // Standing down is therefore `display:none` on the same host: out of the
  // flex column and out of hit testing, just as returning null was, and
  // `collapsable={false}` keeps the native views (and any ScrollView offset
  // inside them) alive through the detour — the same bargain `KeepAlive` makes.
  //
  // An OVERLAY, not a flex sibling. That is what lets the drag actually uncover
  // something: the tab this screen belongs to stays laid out underneath (see
  // App's KeepAlive predicates, which key on `tabOf(currentScreen)` rather than
  // on an exact match), so half a swipe shows half the destination the way
  // every native navigator does.
  //
  // It used to be `flex: 1` alongside the tab layer, which meant exactly one of
  // the two could be laid out at a time — so the tab underneath was
  // `display: none` for the whole gesture and the drag revealed App's bare
  // background. Worse, the destination then had to be laid out and painted at
  // the instant the animation finished, which is the one frame that could least
  // afford it, and read as the whole gesture being sluggish.
  //
  // Every deep screen paints an opaque root, so nothing shows through when the
  // drag is at rest.
  return (
    <View
      style={empty ? styles.hidden : styles.overlay}
      collapsable={false}
      pointerEvents={empty ? 'none' : 'auto'}
      {...pan.panHandlers}
    >
      <Animated.View style={[styles.fill, { transform: [{ translateX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: StyleSheet.absoluteFillObject,
  hidden: { display: 'none' },
});

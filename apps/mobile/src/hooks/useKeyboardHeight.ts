/**
 * useKeyboardHeight — how much of the screen the keyboard is taking, and how
 * long it is taking to get there.
 *
 * Two surfaces file a word into a list and both put their text field at the
 * bottom of a bottom-anchored panel, which is exactly where the keyboard
 * lands: `wordFeed/ListPanel` (the slide-in on the word feed) and
 * `NewListSheet` inside `common/BottomSheet` (the Lists tab). In both, typing
 * a new list's name meant typing into something you could not see.
 *
 * A hook rather than a `KeyboardAvoidingView` at each site because these are
 * absolutely-positioned overlays, not laid-out content.
 * `KeyboardAvoidingView` works by changing padding or height on a container in
 * the layout flow; an overlay pinned with `bottom` has no such container, and
 * wrapping one in it moves the whole card — which is precisely what we do not
 * want here. The panel should rise; the word behind it should stay where the
 * reader left it.
 *
 * ## Why `duration` comes back too
 *
 * A raw height makes the panel *teleport*: state changes in one frame and the
 * keyboard spends the next ~250ms sliding up underneath it. Callers animate
 * to their own target instead, and they need the keyboard's own timing to
 * arrive with it rather than before or after. iOS puts that in the event; on
 * Android there is nothing to read, so `DEFAULT_DURATION` stands in.
 *
 * Matching that duration exactly is not the goal, though — `liftDuration`
 * below runs the panel at a fraction of it on the way up, so the panel is out
 * of the way before the keys arrive rather than shoulder to shoulder with
 * them. The keyboard's timing is still the input; it is the budget the panel
 * has to beat.
 *
 * Deliberately not returning a ready-made `Animated.Value` of the height: the
 * two callers want different offsets from it — one is pinned above a bottom
 * bar and the other to the screen edge — so the useful shared thing is the
 * measurement and the tempo, not the animation.
 *
 * ## Platform
 *
 * iOS gets `keyboardWillShow`/`WillHide`, which fire *before* the animation,
 * so a panel driven from this travels with the keyboard rather than after it.
 * Android has no `will` events — only `keyboardDidShow`/`DidHide` — so there
 * it starts as the keyboard finishes. That difference is inherent to the
 * platforms, not something to paper over with a guessed delay.
 *
 * Android also only reports a height at all under `adjustResize`; under
 * `adjustPan` the OS slides the window itself and the events give 0, which is
 * the right answer — the system has already moved everything, so a caller
 * adding 0 is correct rather than merely harmless.
 */

import { useEffect, useState } from 'react';
import { Easing, Keyboard, Platform } from 'react-native';

/** What Android's keyboard roughly takes, since it does not say. */
const DEFAULT_DURATION = 250;

/**
 * The curve UIKit moves the keyboard on.
 *
 * iOS animates with a private curve (7) that has no `Easing` equivalent; this
 * bezier is the long-standing approximation. Close matters more than exact —
 * the failure people notice is the panel and the keys arriving at different
 * times, not a slightly different acceleration on the way.
 */
export const KEYBOARD_EASING = Easing.bezier(0.17, 0.59, 0.4, 0.77);

/**
 * The fraction of the keyboard's own time a panel takes to make the same trip.
 *
 * Matching the keyboard exactly is correct and reads as sluggish. The keys
 * come from off-screen and are the thing being waited for; the panel is
 * already on screen and is merely getting out of the way, so it should be
 * clear of the space before the keys claim it rather than racing them for it.
 * At 0.6 a 250ms keyboard gets a 150ms panel — settled, then the keys slide
 * in under it.
 */
export const LIFT_SPEEDUP = 0.6;

/** Below this a move stops reading as motion and starts reading as a cut. */
const MIN_LIFT_MS = 120;

/**
 * How long a panel should take to clear a keyboard that moves in `duration`.
 *
 * **Only on the way up.** Going down, the panel must not outrun the keyboard:
 * the keys take their own ~250ms to retract, and a panel that has already
 * finished dropping is a panel sitting behind a keyboard that is still there.
 * Leading is only ever right into empty space.
 *
 * The floor never makes the panel *slower* than the keyboard — a keyboard
 * quicker than `MIN_LIFT_MS` is already fast enough that matching it is fine —
 * and a zero duration passes through untouched, since 60% of "no animation" is
 * still no animation.
 */
export function liftDuration(duration: number, rising: boolean): number {
  if (!rising || duration <= 0) return duration;
  return Math.min(duration, Math.max(MIN_LIFT_MS, Math.round(duration * LIFT_SPEEDUP)));
}

export interface KeyboardState {
  /** Height in points. 0 whenever no keyboard is up. */
  height: number;
  /** How long the keyboard's own move takes, for callers to match. */
  duration: number;
}

export function useKeyboardHeight(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    height: 0,
    duration: DEFAULT_DURATION,
  });

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      setState({
        // `endCoordinates` is where the keyboard is going, not where it is —
        // which is the point of listening to `will` on iOS.
        height: e?.endCoordinates?.height ?? 0,
        // A zero duration is iOS saying "no animation" (a hardware keyboard
        // attaching, a split-keyboard drag). Honouring it is right; falling
        // back to 250 there would animate something that did not move.
        duration: e?.duration ?? DEFAULT_DURATION,
      });
    });
    const hide = Keyboard.addListener(hideEvent, (e) => {
      setState({ height: 0, duration: e?.duration ?? DEFAULT_DURATION });
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return state;
}

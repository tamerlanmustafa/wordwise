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

/**
 * useKeyboardHeight — how much of the screen the keyboard is currently eating.
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
 * reader left it. A number lets each caller decide what moves.
 *
 * ## Platform
 *
 * iOS gets `keyboardWillShow`/`WillHide`, which fire *before* the animation,
 * so the panel travels with the keyboard rather than after it. Android has no
 * `will` events — it only reports `keyboardDidShow`/`DidHide` — so there it is
 * a jump on arrival. That difference is inherent to the platforms, not
 * something to paper over with a guessed duration.
 *
 * Android also only reports a height at all under `adjustResize`; under
 * `adjustPan` the OS slides the window itself and the events give 0, which is
 * the right answer — the system has already moved everything, so a caller
 * adding 0 is correct rather than merely harmless.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      // `endCoordinates` is where the keyboard is going, not where it is —
      // which is the point of listening to `will` on iOS.
      setHeight(e?.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/**
 * useKeyboardHeight — the number two bottom-anchored panels rise by.
 *
 * Both surfaces that file a word into a list put their text field at the
 * bottom of a panel pinned to the bottom of the screen, which is exactly where
 * the keyboard arrives. Naming a new list meant typing into something you
 * could not see, on the word feed and in the Lists tab alike.
 *
 * The reason this is a hook returning a number, rather than a
 * `KeyboardAvoidingView` at each site, is that the callers are absolutely
 * positioned overlays. `KeyboardAvoidingView` moves a container in the layout
 * flow; the container here is the whole word card, and moving that is the one
 * outcome we are trying to avoid. A number lets each caller move only itself.
 */

import { Keyboard, Platform } from 'react-native';
import { act } from 'react-test-renderer';

import { renderHook, cleanupHooks } from '../../test-utils/renderHook';
import { useKeyboardHeight } from '../useKeyboardHeight';

type Handler = (e?: { endCoordinates?: { height: number } }) => void;

/** Stands in for the native keyboard, so a test can raise and drop it. */
function mockKeyboard() {
  const handlers: Record<string, Handler> = {};
  const removals: string[] = [];
  jest
    .spyOn(Keyboard, 'addListener')
    // Cast at the boundary: RN types `addListener` per known event name with a
    // fully-populated `KeyboardEvent`, and these tests deliberately fire
    // partial ones — a height-less event is the Android `adjustPan` case and
    // has to be expressible here.
    .mockImplementation(((event: string, handler: Handler) => {
      handlers[event] = handler;
      return { remove: () => removals.push(event) };
    }) as unknown as typeof Keyboard.addListener);
  return { handlers, removals };
}

describe('useKeyboardHeight', () => {
  afterEach(() => {
    cleanupHooks();
    jest.restoreAllMocks();
  });

  it('starts at zero', () => {
    mockKeyboard();
    expect(renderHook(() => useKeyboardHeight()).result.current).toBe(0);
  });

  it('reports where the keyboard is going, not where it is', () => {
    // `endCoordinates` is the destination. On iOS this fires *before* the
    // animation, which is what lets the panel travel with the keyboard rather
    // than jump after it has arrived.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({ endCoordinates: { height: 336 } }));

    expect(result.current).toBe(336);
  });

  it('returns to zero when the keyboard goes away', () => {
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({ endCoordinates: { height: 336 } }));
    act(() => handlers.keyboardWillHide?.());

    expect(result.current).toBe(0);
  });

  it('treats a height-less event as zero rather than NaN', () => {
    // Android under `adjustPan` reports no coordinates: the OS has already
    // slid the window, so zero is the correct answer, not a fallback. A
    // caller adding `undefined` would produce NaN and lay out nothing.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardDidShow?.({}));
    act(() => handlers.keyboardWillShow?.({}));

    expect(result.current).toBe(0);
  });

  it('listens for the events its platform actually emits', () => {
    // Android has no `will` events at all. Subscribing to them there would
    // mean the panel never moves.
    const { handlers } = mockKeyboard();
    renderHook(() => useKeyboardHeight());

    const expected =
      Platform.OS === 'ios'
        ? ['keyboardWillShow', 'keyboardWillHide']
        : ['keyboardDidShow', 'keyboardDidHide'];
    expect(Object.keys(handlers).sort()).toEqual([...expected].sort());
  });

  it('removes both listeners on unmount', () => {
    // The panel mounts and unmounts with the word feed; leaked listeners
    // would set state on a dead component on every keyboard event.
    const { removals } = mockKeyboard();
    renderHook(() => useKeyboardHeight()).unmount();

    expect(removals).toHaveLength(2);
  });
});

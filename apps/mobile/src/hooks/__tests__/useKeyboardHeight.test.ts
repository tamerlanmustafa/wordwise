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
import { LIFT_SPEEDUP, liftDuration, useKeyboardHeight } from '../useKeyboardHeight';

type Handler = (e?: { endCoordinates?: { height: number }; duration?: number }) => void;

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
    expect(renderHook(() => useKeyboardHeight()).result.current.height).toBe(0);
  });

  it('reports where the keyboard is going, not where it is', () => {
    // `endCoordinates` is the destination. On iOS this fires *before* the
    // animation, which is what lets the panel travel with the keyboard rather
    // than jump after it has arrived.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({ endCoordinates: { height: 336 } }));

    expect(result.current.height).toBe(336);
  });

  it("reports the keyboard's own duration so callers can match it", () => {
    // A raw height makes a panel teleport: state lands in one frame and the
    // keyboard spends the next ~250ms sliding up underneath it. Callers
    // animate on this instead, so the two arrive together.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({
      endCoordinates: { height: 336 },
      duration: 310,
    }));

    expect(result.current.duration).toBe(310);
  });

  it('honours a zero duration rather than substituting a default', () => {
    // Zero is iOS saying "no animation" — a hardware keyboard attaching, a
    // split-keyboard drag. Falling back to 250 there would animate something
    // that did not move.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({
      endCoordinates: { height: 336 },
      duration: 0,
    }));

    expect(result.current.duration).toBe(0);
  });

  it('returns to zero when the keyboard goes away', () => {
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardWillShow?.({ endCoordinates: { height: 336 } }));
    act(() => handlers.keyboardWillHide?.());

    expect(result.current.height).toBe(0);
  });

  it('treats a height-less event as zero rather than NaN', () => {
    // Android under `adjustPan` reports no coordinates: the OS has already
    // slid the window, so zero is the correct answer, not a fallback. A
    // caller adding `undefined` would produce NaN and lay out nothing.
    const { handlers } = mockKeyboard();
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => handlers.keyboardDidShow?.({}));
    act(() => handlers.keyboardWillShow?.({}));

    expect(result.current.height).toBe(0);
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

/**
 * `liftDuration` — the panel gets there first.
 *
 * Moving in lockstep with the keyboard is what the panel used to do, and it
 * read as the panel being dragged up by the keys rather than getting out of
 * their way. The panel is already on screen and only has to clear a space the
 * keyboard is about to occupy, so it should be settled before the keys land.
 */
describe('liftDuration', () => {
  it('rises in a fraction of the keyboard time', () => {
    expect(liftDuration(250, true)).toBe(150);
    expect(liftDuration(250, true)).toBe(Math.round(250 * LIFT_SPEEDUP));
  });

  it('actually leads rather than merely differing', () => {
    // The whole point is arriving early, so this is the property that must
    // hold for every plausible keyboard, not just the 250ms one.
    for (const d of [180, 220, 250, 300, 400, 550]) {
      expect(liftDuration(d, true)).toBeLessThan(d);
    }
  });

  it('falls at the keyboard’s own pace', () => {
    // Going down, leading means the panel finishes its drop while the keys are
    // still on screen — i.e. it parks itself behind a keyboard that has not
    // left yet. Empty space is the only thing worth racing into.
    expect(liftDuration(250, false)).toBe(250);
    expect(liftDuration(310, false)).toBe(310);
  });

  it('does not shorten a move below the point of being seen', () => {
    // 60% of a 150ms keyboard is 90ms, which stops reading as movement and
    // starts reading as a cut between two positions.
    expect(liftDuration(150, true)).toBe(120);
  });

  it('never lets the floor make the panel the slower of the two', () => {
    // A keyboard faster than the floor is already fast enough; clamping up to
    // 120 there would have the panel trailing the keys, which is the exact
    // thing this function exists to prevent.
    expect(liftDuration(90, true)).toBe(90);
    expect(liftDuration(120, true)).toBe(120);
  });

  it('leaves a zero duration at zero', () => {
    // Zero is iOS saying "no animation" — a hardware keyboard attaching. A
    // fraction of no animation is still no animation, and the floor must not
    // turn it into a 120ms slide of something that never moved.
    expect(liftDuration(0, true)).toBe(0);
    expect(liftDuration(0, false)).toBe(0);
  });
});

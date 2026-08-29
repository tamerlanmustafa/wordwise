import { useFeedLevel } from '../useFeedLevel';
import { renderHook, cleanupHooks, act } from '../../test-utils/renderHook';

describe('useFeedLevel', () => {
  afterEach(() => {
    cleanupHooks();
  });

  it('starts at the profile level', () => {
    const { result } = renderHook(() => useFeedLevel('C1'));
    expect(result.current[0]).toBe('C1');
  });

  it('falls back to B1 when the profile has no level yet', () => {
    const { result } = renderHook(() => useFeedLevel(undefined));
    expect(result.current[0]).toBe('B1');
  });

  it('adopts the real level when the profile arrives after mount', () => {
    // The cold-start case: Home is inside KeepAlive and can mount before the
    // user has loaded. The old `useState(user?.proficiency_level || 'B1')`
    // froze the fallback here and never picked up the real level.
    let profile: string | undefined;
    const { result, rerender } = renderHook(() => useFeedLevel(profile));
    expect(result.current[0]).toBe('B1');

    profile = 'A2';
    rerender();
    expect(result.current[0]).toBe('A2');
  });

  it('follows a level changed in Settings while Home stays mounted', () => {
    let profile = 'B1';
    const { result, rerender } = renderHook(() => useFeedLevel(profile));

    profile = 'B2';
    rerender();
    expect(result.current[0]).toBe('B2');
  });

  it('keeps a hand-picked level across re-renders', () => {
    // Re-rendering for an unrelated reason must not snap the feed back to the
    // profile — that would undo the pick mid-browse.
    const { result, rerender } = renderHook(() => useFeedLevel('B1'));

    act(() => {
      result.current[1]('C2');
    });
    expect(result.current[0]).toBe('C2');

    rerender();
    expect(result.current[0]).toBe('C2');
  });

  it('lets a genuine profile change override a hand-picked level', () => {
    // The profile owns this value; a manual pick is a session-scoped
    // excursion, so the owner wins when it actually changes.
    let profile = 'B1';
    const { result, rerender } = renderHook(() => useFeedLevel(profile));

    act(() => {
      result.current[1]('A1');
    });
    expect(result.current[0]).toBe('A1');

    profile = 'C1';
    rerender();
    expect(result.current[0]).toBe('C1');
  });

  it('ignores the profile going empty, so a logout blip cannot reset the feed', () => {
    let profile: string | undefined = 'C2';
    const { result, rerender } = renderHook(() => useFeedLevel(profile));

    profile = undefined;
    rerender();
    expect(result.current[0]).toBe('C2');
  });
});

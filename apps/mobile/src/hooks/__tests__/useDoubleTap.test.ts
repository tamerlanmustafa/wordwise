import { useDoubleTap } from '../useDoubleTap';
import { renderHook, cleanupHooks } from '../../test-utils/renderHook';

describe('useDoubleTap', () => {
  let nowSpy: jest.SpyInstance;
  let clock = 0;

  beforeEach(() => {
    clock = 1000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    cleanupHooks();
  });

  it('does not fire on a single tap', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDoubleTap(cb));
    result.current();
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires once on two taps inside the window', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDoubleTap(cb, 300));
    result.current(); // arm
    clock += 100; // within 300ms
    result.current(); // fire
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the second tap is outside the window', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDoubleTap(cb, 300));
    result.current();
    clock += 400; // past the 300ms window
    result.current();
    expect(cb).not.toHaveBeenCalled();
  });

  it('re-arms after a successful double tap (three quick taps = one fire)', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDoubleTap(cb, 300));
    result.current(); // arm
    clock += 50;
    result.current(); // fire #1, resets
    clock += 50;
    result.current(); // arms again, does not fire
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('honours a custom delay', () => {
    const cb = jest.fn();
    const { result } = renderHook(() => useDoubleTap(cb, 1000));
    result.current();
    clock += 800; // would miss the default 300ms, but within the custom 1000ms
    result.current();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

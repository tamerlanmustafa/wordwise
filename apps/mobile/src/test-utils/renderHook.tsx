/**
 * Tiny renderHook helper built on react-test-renderer (already a dev dep).
 *
 * The repo deliberately has no @testing-library/react-native, so this gives
 * hook tests a render context (needed for useRef/useState/useEffect and
 * zustand selector subscriptions) WITHOUT pulling in a component-testing
 * framework. It renders a host component that returns null — no native views
 * are mounted, so there's nothing to "click"; we only observe hook output.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

export interface RenderHookResult<T> {
  /** Latest value returned by the hook. `current` updates on every render. */
  result: { current: T };
  rerender: () => void;
  unmount: () => void;
}

// Track every live renderer so a test that reads `.result.current` inline
// (and discards the handle) doesn't leak a mounted, store-subscribed host
// into the next test — a later store setState would re-render it outside
// act() and trip React's "not wrapped in act" warning. Call cleanupHooks()
// from an afterEach.
const liveRenderers = new Set<TestRenderer.ReactTestRenderer>();

export function renderHook<T>(useHook: () => T): RenderHookResult<T> {
  const result = { current: undefined as unknown as T };

  function HookHost() {
    result.current = useHook();
    return null;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<HookHost />);
  });
  liveRenderers.add(renderer);

  const unmount = () => {
    if (!liveRenderers.has(renderer)) return;
    act(() => {
      renderer.unmount();
    });
    liveRenderers.delete(renderer);
  };

  return {
    result,
    rerender: () => {
      act(() => {
        renderer.update(<HookHost />);
      });
    },
    unmount,
  };
}

/** Unmount every hook host rendered so far. Call from afterEach in hook tests. */
export function cleanupHooks(): void {
  liveRenderers.forEach((renderer) => {
    act(() => {
      renderer.unmount();
    });
  });
  liveRenderers.clear();
}

/** Flush pending promises + microtasks so async hook state settles. */
export async function flushAsync(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export { act };

/**
 * navBarStore — the shared "is the bottom bar retracted" flag.
 *
 * The thing worth testing is not that a setter sets: it is that the store
 * cannot strand the user without navigation, and that a 60fps scroll does not
 * notify subscribers on every frame.
 */

import { useNavBarStore } from '../navBarStore';

const reset = () => useNavBarStore.setState({ collapsed: false });

beforeEach(reset);

describe('navBarStore', () => {
  it('starts expanded — a cold start always shows the bar', () => {
    expect(useNavBarStore.getState().collapsed).toBe(false);
  });

  it('collapses and expands', () => {
    useNavBarStore.getState().setCollapsed(true);
    expect(useNavBarStore.getState().collapsed).toBe(true);
    useNavBarStore.getState().setCollapsed(false);
    expect(useNavBarStore.getState().collapsed).toBe(false);
  });

  it('reset() always brings the bar back', () => {
    useNavBarStore.getState().setCollapsed(true);
    useNavBarStore.getState().reset();
    expect(useNavBarStore.getState().collapsed).toBe(false);
  });

  it('reset() on an already-visible bar is a no-op, not a re-notify', () => {
    const seen: boolean[] = [];
    const unsub = useNavBarStore.subscribe((s) => seen.push(s.collapsed));
    useNavBarStore.getState().reset();
    useNavBarStore.getState().reset();
    unsub();
    expect(seen).toEqual([]);
  });

  it('only notifies on an actual flip, not on every scroll frame', () => {
    // setCollapsed runs once per scroll event. Without the guard, a downward
    // browse would push a store update ~60 times a second and re-render the
    // bar for each one.
    const seen: boolean[] = [];
    const unsub = useNavBarStore.subscribe((s) => seen.push(s.collapsed));

    const set = useNavBarStore.getState().setCollapsed;
    for (let i = 0; i < 50; i++) set(true); // sustained downward scroll
    for (let i = 0; i < 50; i++) set(false); // sustained upward scroll
    unsub();

    expect(seen).toEqual([true, false]);
  });
});

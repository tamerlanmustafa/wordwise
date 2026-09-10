/**
 * The toast stack when the buttons come in bursts.
 *
 * Toasts exist for exactly the actions people fire in a row — "seen it", "not
 * interested", save, save, save — so the burst is the normal case, not the
 * edge case. Two things have to survive it: the stack must stay small enough
 * to not paper over the screen it is describing, and every toast's Undo must
 * stay reachable while it is still the thing you would undo.
 *
 * Ids are the other half. `nextId` is a counter plus a timestamp, and a burst
 * inside one millisecond is precisely where a timestamp stops disambiguating —
 * so a collision would mean dismissing one toast silently dismisses another.
 */

import { forSeeds } from '../../test-utils/fuzz';
import {
  useToastStore,
  visibleToasts,
  showToast,
  VISIBLE_TOAST_LIMIT,
} from '../toastStore';

const reset = () => useToastStore.setState({ queue: [] });
const queue = () => useToastStore.getState().queue;

beforeEach(reset);

describe('toast bursts', () => {
  it('gives every toast in a burst its own id', () => {
    // 500 in one synchronous run, which is the same millisecond — the case the
    // timestamp half of the id cannot help with.
    const ids = Array.from({ length: 500 }, (_, i) => showToast({ message: `m${i}` }));
    expect(new Set(ids).size).toBe(500);
  });

  it('shows at most the visible limit however many arrive', () => {
    for (let i = 0; i < 200; i += 1) showToast({ message: `m${i}` });
    expect(visibleToasts(queue()).length).toBe(VISIBLE_TOAST_LIMIT);
  });

  it('shows the OLDEST, so an arriving toast never displaces one you are aiming at', () => {
    const ids = Array.from({ length: 20 }, (_, i) => showToast({ message: `m${i}` }));
    expect(visibleToasts(queue()).map((t) => t.id)).toEqual(ids.slice(0, VISIBLE_TOAST_LIMIT));
  });

  it('dismisses exactly one toast per id, whatever order they go in', () => {
    forSeeds(20, (rng) => {
      reset();
      const ids = Array.from({ length: 60 }, (_, i) => showToast({ message: `m${i}` }));
      const order = [...ids].sort(() => (rng.chance(0.5) ? 1 : -1));
      let expected = ids.length;
      for (const id of order) {
        useToastStore.getState().dismiss(id);
        expected -= 1;
        expect(queue()).toHaveLength(expected);
      }
      expect(queue()).toHaveLength(0);
    });
  });

  it('treats a repeated dismiss as a no-op, not as a second removal', () => {
    // The real gesture: a double-tap on the toast's X, or the auto-dismiss
    // timer firing on a toast the user already swiped away.
    const ids = Array.from({ length: 10 }, (_, i) => showToast({ message: `m${i}` }));
    for (let i = 0; i < 5; i += 1) useToastStore.getState().dismiss(ids[0]);
    expect(queue()).toHaveLength(9);
    expect(queue().map((t) => t.id)).not.toContain(ids[0]);
  });

  it('ignores a dismiss for something that was never there', () => {
    showToast({ message: 'a' });
    useToastStore.getState().dismiss('toast_does_not_exist');
    expect(queue()).toHaveLength(1);
  });

  it('promotes the next toast the moment one leaves, with no gap', () => {
    const ids = Array.from({ length: 10 }, (_, i) => showToast({ message: `m${i}` }));
    useToastStore.getState().dismiss(ids[0]);
    expect(visibleToasts(queue()).map((t) => t.id)).toEqual(ids.slice(1, 1 + VISIBLE_TOAST_LIMIT));
  });

  it('survives interleaved shows and dismisses', () => {
    forSeeds(20, (rng) => {
      reset();
      const live: string[] = [];
      for (let step = 0; step < 400; step += 1) {
        if (live.length > 0 && rng.chance(0.45)) {
          const idx = rng.int(live.length);
          useToastStore.getState().dismiss(live[idx]);
          live.splice(idx, 1);
        } else {
          live.push(showToast({ message: `m${step}` }));
        }
        expect(queue().map((t) => t.id)).toEqual(live);
        expect(visibleToasts(queue()).length).toBeLessThanOrEqual(VISIBLE_TOAST_LIMIT);
      }
    });
  });

  it('clears everything, including what was queued behind the visible stack', () => {
    for (let i = 0; i < 50; i += 1) showToast({ message: `m${i}` });
    useToastStore.getState().clear();
    expect(queue()).toEqual([]);
    expect(visibleToasts(queue())).toEqual([]);
  });

  it('keeps each toast carrying its own action', () => {
    // The stack shares a component; it must not share a callback. A burst of
    // three saves has three different words to undo.
    const calls: number[] = [];
    const ids = Array.from({ length: 5 }, (_, i) =>
      showToast({ message: `m${i}`, actionLabel: 'Undo', onAction: () => calls.push(i) }),
    );
    for (const t of queue()) t.onAction?.();
    expect(calls).toEqual([0, 1, 2, 3, 4]);
    expect(ids).toHaveLength(5);
  });
});

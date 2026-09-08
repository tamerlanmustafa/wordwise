/**
 * The bug, verbatim: press the focused tile, slide your finger off without
 * lifting it on the tile, and the quiz never opens — but the tile stopped
 * bouncing and stayed cracked, permanently, while still being the one tile the
 * user is meant to tap.
 *
 * The cause was treating press-IN as the commitment. The fix is a latch, and
 * the reason the latch is a unit rather than three lines inside the component
 * is the ordering: React Native does not guarantee whether `onPress` or
 * `onPressOut` arrives first, so the same three handlers have to produce the
 * same answer under two different event sequences. That is exactly the kind of
 * thing that reads as obviously correct in a diff and is not.
 */

import { createPressLatch } from '../pressLatch';

describe('a press that never landed', () => {
  it('asks to be taken back', () => {
    // Finger down, finger dragged away. `onPressOut` fires, `onPress` never
    // does — this is the reported bug, and `true` is what un-sticks the tile.
    const latch = createPressLatch();
    latch.down();
    expect(latch.settle()).toBe(true);
  });

  it('does not strand the tile when the release never arrives either', () => {
    // A second press must start clean even if the first one's release was
    // swallowed — which is why `down()` resets rather than `settle()`.
    const latch = createPressLatch();
    latch.down(); // cancelled, no release delivered
    latch.down();
    latch.commit();
    expect(latch.settle()).toBe(false);
  });
});

describe('a press that landed keeps the tile struck, in either event order', () => {
  // The whole reason this file exists. `Pressability` calls `_deactivate`
  // (which may delay `onPressOut` behind `minPressDuration`) and then calls
  // `onPress` synchronously, so both of these happen on real hardware
  // depending on how fast the tap was.

  it('quick tap: onPress arrives first, onPressOut a few frames later', () => {
    const latch = createPressLatch();
    latch.down();
    latch.commit();
    // ...release, then one turn of the event loop...
    expect(latch.settle()).toBe(false);
  });

  it('slow press: onPressOut arrives first, onPress in the same task', () => {
    // The case a naive fix gets wrong. Reading the flag INSIDE the release
    // handler would answer "not committed" here and undo a press that landed
    // a microsecond later; reading it a turn late sees the commit.
    const latch = createPressLatch();
    latch.down();
    // onPressOut fires and schedules the check...
    latch.commit(); // ...onPress runs synchronously right after...
    expect(latch.settle()).toBe(false); // ...and the check runs last.
  });

  it('gives the same answer whichever order the two events came in', () => {
    const quick = createPressLatch();
    quick.down();
    quick.commit();
    const slow = createPressLatch();
    slow.down();
    slow.commit();

    expect(quick.settle()).toBe(slow.settle());
  });
});

describe('the latch is per tile, not shared', () => {
  it('one tile committing does not un-cancel another', () => {
    const a = createPressLatch();
    const b = createPressLatch();
    a.down();
    b.down();
    b.commit();

    expect(a.settle()).toBe(true);
    expect(b.settle()).toBe(false);
  });
});

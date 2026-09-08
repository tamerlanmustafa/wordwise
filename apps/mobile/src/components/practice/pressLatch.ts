/**
 * pressLatch — did that press actually happen, or did the finger slide away?
 *
 * A practice tile marks the floor the moment a finger lands on it, and stops
 * bouncing for good, because a tap is a commitment. Except that a press-in is
 * not a commitment: drag your finger off a `Pressable` and the press is
 * cancelled — `onPress` never fires, nothing navigates — and the tile was
 * left permanently still and cracked, still being the one tile the user is
 * meant to tap. That is the bug this exists to make impossible.
 *
 * ## Why it is a state machine and not an `if`
 *
 * The obvious fix is "on release, undo it unless the press landed". The catch
 * is that `onPress` and `onPressOut` have **no stable order**. React Native's
 * `Pressability` handles a release by calling `_deactivate` — which may put
 * `onPressOut` behind a `minPressDuration` timer — and *then* calling
 * `onPress` synchronously. So:
 *
 *   • quick tap → `onPress`, then `onPressOut` a few frames later
 *   • slow press → `onPressOut`, then `onPress` in the same synchronous task
 *
 * Read the flag inside `onPressOut` and the second case answers "not
 * committed" for a press that committed a microsecond later. The fix is to
 * read it one turn of the event loop after the release, which is what
 * {@link PressLatch.settle} is for: by then `onPress` has run under both
 * orders, because the undelayed `onPressOut` shares its task.
 *
 * That timing is the entire subtlety here, and it is invisible in the
 * component — three handlers that each look obviously correct, composing into
 * something that is not. Hence a unit that can be driven through both orders
 * in a test rather than a comment claiming it works.
 */

export interface PressLatch {
  /** `onPressIn` — a finger landed. Starts a fresh press. */
  down(): void;
  /** `onPress` — the press completed and the tile's action is running. */
  commit(): void;
  /**
   * Called one turn after `onPressOut`. True means the press never landed and
   * whatever `down()` set should be taken back.
   */
  settle(): boolean;
}

export function createPressLatch(): PressLatch {
  let committed = false;
  return {
    down() {
      // Reset here rather than in `settle`, so a press that follows a
      // cancelled one starts clean even if its release never arrived.
      committed = false;
    },
    commit() {
      committed = true;
    },
    settle() {
      return !committed;
    },
  };
}

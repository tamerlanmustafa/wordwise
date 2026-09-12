/**
 * When arming a streak freeze is allowed, as pure functions.
 *
 * These live outside `FreezeSheet` for two reasons. The rules are less obvious
 * than they look — "you hold three freezes" does not mean you can arm three,
 * and it does not even mean you can arm one — and this suite has no
 * component-render library, so logic inside a component is logic no test can
 * reach.
 *
 * None of this is the enforcement. The server owns the cap and returns the
 * settled counts from every mutation; these predicates only decide whether a
 * button looks available. Getting them wrong shows the user a control that
 * gets politely declined, not a wrong outcome — which is the right side of
 * that trade to be on.
 */

/**
 * Slots the sheet draws, mirroring `MAX_EQUIPPED_FREEZES` in
 * `backend/src/services/streak_service.py`.
 */
export const ARMED_SLOTS = 2;

export interface FreezeCounts {
  /** Freezes owned, armed or not. */
  held: number;
  /** Of those, how many are standing guard. */
  equipped: number;
}

/**
 * Can the user arm one more?
 *
 * Two conditions, and the second is the one that surprises people: there must
 * be a free slot AND an unarmed freeze to put in it. `held` counts the armed
 * ones too, so a user holding exactly two, both armed, has `held > equipped`
 * false and correctly cannot arm a third.
 */
export function canArm({ held, equipped }: FreezeCounts): boolean {
  return equipped < ARMED_SLOTS && held > equipped;
}

/** Can the user stand one down? Only if one is actually armed. */
export function canDisarm({ equipped }: FreezeCounts): boolean {
  return equipped > 0;
}

/**
 * Freezes owned but not armed — what the sheet calls "in reserve".
 *
 * Floored at zero deliberately. `equipped > held` should be impossible, but it
 * is two independent counts from two queries, and a negative reserve printed
 * in the header is a worse failure than a momentarily optimistic zero.
 */
export function reserveCount({ held, equipped }: FreezeCounts): number {
  return Math.max(0, held - equipped);
}

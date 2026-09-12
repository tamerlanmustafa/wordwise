/**
 * When arming a streak freeze is allowed, as pure functions.
 *
 * These live outside `FreezeSheet` for two reasons. The rules are less obvious
 * than they look — "you hold three freezes" does not mean you can arm three,
 * and it does not even mean you can arm one — and this suite has no
 * component-render library, so logic inside a component is logic no test can
 * reach.
 *
 * None of this is the enforcement. The server owns the caps and returns the
 * settled counts from every mutation; these predicates only decide whether a
 * button looks available. Getting them wrong shows the user a control that
 * gets politely declined, not a wrong outcome — which is the right side of
 * that trade to be on.
 *
 * ## The cap is not a constant any more
 *
 * It is tier-dependent (free arms one, Plus arms two) and it arrives on
 * `/daily/state`. A hardcoded 2 would draw a free account two slots, one of
 * which can never fill — an upsell by accident, and a control that is refused
 * every single time it is tapped. So the cap is a parameter everywhere below,
 * and the fallback when the server has not answered yet is the FREE value:
 * understating what someone has is recoverable in a way that promising a slot
 * that does not exist is not.
 */

/**
 * What to assume before `/daily/state` answers, and for a server too old to
 * send the caps. The cautious end of the range on purpose — see above.
 */
export const FREE_ARMED_SLOTS = 1;
export const FREE_HELD_CAP = 2;

/** The most any tier can arm — what the locked slots are counted against. */
export const PREMIUM_ARMED_SLOTS = 2;

export interface FreezeCounts {
  /** Freezes owned, armed or not. */
  held: number;
  /** Of those, how many are standing guard. */
  equipped: number;
  /** This account's armed-slot cap, from the server. */
  maxEquipped?: number;
}

/** The account's slot count, defaulting to the free tier's. */
export function armedSlots(counts: Pick<FreezeCounts, 'maxEquipped'>): number {
  const n = counts.maxEquipped;
  return typeof n === 'number' && n > 0 ? n : FREE_ARMED_SLOTS;
}

/**
 * Can the user arm one more?
 *
 * Two conditions, and the second is the one that surprises people: there must
 * be a free slot AND an unarmed freeze to put in it. `held` counts the armed
 * ones too, so a user holding exactly two, both armed, has `held > equipped`
 * false and correctly cannot arm a third.
 */
export function canArm(counts: FreezeCounts): boolean {
  return counts.equipped < armedSlots(counts) && counts.held > counts.equipped;
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

/**
 * Is this account looking at a slot it cannot use?
 *
 * True only for an account whose cap is below the highest cap any tier gets —
 * i.e. a free user, who sees their one live slot plus one locked one. The
 * locked slot is the upsell, and it appears at the moment the user is already
 * thinking about protecting their streak, which is the only moment it is
 * welcome rather than an interruption.
 */
export function lockedSlots(counts: Pick<FreezeCounts, 'maxEquipped'>): number {
  return Math.max(0, PREMIUM_ARMED_SLOTS - armedSlots(counts));
}

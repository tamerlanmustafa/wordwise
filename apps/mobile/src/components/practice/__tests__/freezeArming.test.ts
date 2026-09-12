/**
 * Arming a freeze, and the one rule nobody guesses right.
 *
 * The freeze mechanic changed from "the app spends them for you" to "you arm
 * them in advance", and the arming rules read simpler than they are: holding
 * three freezes does not mean you can arm three, and — the case that catches
 * people — holding two does not mean you can arm one, if both are already
 * armed. `held` counts the armed ones too.
 *
 * The cap is also no longer a constant. It is tier-dependent (free arms one,
 * Plus arms two) and arrives from the server, so these helpers take it as a
 * parameter and every default here is the FREE value. That asymmetry is
 * deliberate and is the thing most worth testing: understating what someone
 * has is a recoverable disappointment, while drawing a slot that can never
 * fill is a control refused every single time it is tapped.
 *
 * The server enforces all of this; these predicates only decide what the
 * buttons look like. That is deliberately the cheap side of the trade, but
 * "cheap to get wrong" is not "fine to get wrong": a permanently greyed-out
 * Arm button makes a shipped mechanic look broken, and nobody files a bug
 * against a button that never did anything.
 */

import {
  FREE_ARMED_SLOTS,
  PREMIUM_ARMED_SLOTS,
  armedSlots,
  canArm,
  canDisarm,
  lockedSlots,
  reserveCount,
} from '../freezeArming';

/** A free account, as the server describes it. */
const free = (held: number, equipped: number) => ({
  held,
  equipped,
  maxEquipped: FREE_ARMED_SLOTS,
});
/** A Plus account. */
const plus = (held: number, equipped: number) => ({
  held,
  equipped,
  maxEquipped: PREMIUM_ARMED_SLOTS,
});

describe('the slot count comes from the server', () => {
  it('falls back to the free tier before the server has answered', () => {
    // `/daily/state` has not resolved, so there is no cap yet. Assuming the
    // generous one would draw a second slot to an account that does not have
    // it — and every tap on it would be refused.
    expect(armedSlots({})).toBe(FREE_ARMED_SLOTS);
    expect(armedSlots({ maxEquipped: undefined })).toBe(FREE_ARMED_SLOTS);
  });

  it('ignores a nonsensical cap rather than drawing zero slots', () => {
    // A zero or negative cap from a confused server would render a sheet with
    // no slots at all, which reads as "you have no freezes" — a different and
    // alarming claim.
    expect(armedSlots({ maxEquipped: 0 })).toBe(FREE_ARMED_SLOTS);
    expect(armedSlots({ maxEquipped: -1 })).toBe(FREE_ARMED_SLOTS);
  });

  it('uses the cap it is given', () => {
    expect(armedSlots({ maxEquipped: 1 })).toBe(1);
    expect(armedSlots({ maxEquipped: 2 })).toBe(2);
  });
});

describe('canArm', () => {
  it('is false with nothing held', () => {
    expect(canArm(free(0, 0))).toBe(false);
    expect(canArm(plus(0, 0))).toBe(false);
  });

  it('is true holding one, armed none, on either tier', () => {
    expect(canArm(free(1, 0))).toBe(true);
    expect(canArm(plus(1, 0))).toBe(true);
  });

  it('is false when every freeze held is already armed', () => {
    // The rule people get wrong. Two held and two armed is not "two spare".
    expect(canArm(plus(2, 2))).toBe(false);
    expect(canArm(free(1, 1))).toBe(false);
  });

  it('stops a free account at one even with freezes to spare', () => {
    // The whole tier split, in one assertion. A free user holding five can
    // arm exactly one of them.
    expect(canArm(free(5, 1))).toBe(false);
    expect(canArm(plus(5, 1))).toBe(true);
  });

  it('is false at the slot cap even with plenty in reserve', () => {
    expect(canArm(plus(5, PREMIUM_ARMED_SLOTS))).toBe(false);
  });

  it('stays false if the counts ever contradict each other', () => {
    // Two independent queries; `equipped > held` should be impossible, but a
    // predicate that answers "yes, arm another" to nonsense is how one bad
    // read becomes a request loop.
    expect(canArm(plus(0, 1))).toBe(false);
  });
});

describe('canDisarm', () => {
  it('is false with none armed', () => {
    expect(canDisarm(free(4, 0))).toBe(false);
  });

  it('is true with any armed, on either tier', () => {
    expect(canDisarm(free(1, 1))).toBe(true);
    expect(canDisarm(plus(5, 2))).toBe(true);
  });

  it('does not care how many are held', () => {
    // Standing one down is always allowed — it is the undo, and gating it on
    // anything would strand a user who armed one by accident.
    expect(canDisarm(free(0, 1))).toBe(true);
  });
});

describe('reserveCount', () => {
  it('counts only the unarmed ones', () => {
    expect(reserveCount(plus(3, 1))).toBe(2);
    expect(reserveCount(plus(2, 2))).toBe(0);
  });

  it('never goes negative', () => {
    // "-1 more in reserve" printed in the sheet header is worse than a
    // momentarily optimistic zero.
    expect(reserveCount(plus(0, 2))).toBe(0);
  });
});

describe('lockedSlots — the upsell', () => {
  it('shows a free account exactly one locked slot', () => {
    expect(lockedSlots({ maxEquipped: FREE_ARMED_SLOTS })).toBe(1);
  });

  it('shows a Plus account none', () => {
    // Selling someone what they already pay for is the fastest way to make an
    // upsell read as spam.
    expect(lockedSlots({ maxEquipped: PREMIUM_ARMED_SLOTS })).toBe(0);
  });

  it('never goes negative if a tier ever exceeds the premium cap', () => {
    expect(lockedSlots({ maxEquipped: 99 })).toBe(0);
  });

  it('live slots plus locked slots is the same total on every tier', () => {
    // So the row does not change width between tiers, and a user who upgrades
    // sees a lock become a slot rather than the panel reflowing.
    for (const cap of [FREE_ARMED_SLOTS, PREMIUM_ARMED_SLOTS]) {
      expect(armedSlots({ maxEquipped: cap }) + lockedSlots({ maxEquipped: cap }))
        .toBe(PREMIUM_ARMED_SLOTS);
    }
  });
});

describe('the two buttons are never both dead while something is possible', () => {
  it('offers at least one action for every reachable state, on both tiers', () => {
    // A sheet where neither button works is a dead end the user cannot read
    // their way out of. The only states that legitimately offer nothing are
    // "you own no freezes" — which the sheet answers with its own copy.
    for (const cap of [FREE_ARMED_SLOTS, PREMIUM_ARMED_SLOTS]) {
      for (let held = 0; held <= 5; held += 1) {
        for (let equipped = 0; equipped <= Math.min(held, cap); equipped += 1) {
          const counts = { held, equipped, maxEquipped: cap };
          const dead = !canArm(counts) && !canDisarm(counts);
          expect({ ...counts, dead }).toEqual({ ...counts, dead: held === 0 });
        }
      }
    }
  });
});

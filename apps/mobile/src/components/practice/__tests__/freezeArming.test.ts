/**
 * Arming a freeze, and the one rule nobody guesses right.
 *
 * The freeze mechanic changed from "the app spends them for you" to "you arm
 * them in advance", and the arming rules read simpler than they are: holding
 * three freezes does not mean you can arm three, and — the case that catches
 * people — holding two does not mean you can arm one, if both are already
 * armed. `held` counts the armed ones too.
 *
 * The server enforces all of this; these predicates only decide what the
 * buttons look like. That is deliberately the cheap side of the trade, but
 * "cheap to get wrong" is not "fine to get wrong": a permanently greyed-out
 * Arm button makes a shipped mechanic look broken, and nobody files a bug
 * against a button that never did anything.
 */

import {
  ARMED_SLOTS,
  canArm,
  canDisarm,
  reserveCount,
} from '../freezeArming';

describe('the slot count', () => {
  it('matches the server cap', () => {
    // Mirrors MAX_EQUIPPED_FREEZES. Drift costs a wrong-looking row of slots,
    // never a wrong outcome — the server returns the settled counts.
    expect(ARMED_SLOTS).toBe(2);
  });
});

describe('canArm', () => {
  it('is false with nothing held', () => {
    expect(canArm({ held: 0, equipped: 0 })).toBe(false);
  });

  it('is true holding one, armed none', () => {
    expect(canArm({ held: 1, equipped: 0 })).toBe(true);
  });

  it('is false when every freeze held is already armed', () => {
    // The rule people get wrong. Two held and two armed is not "two spare".
    expect(canArm({ held: 2, equipped: 2 })).toBe(false);
    expect(canArm({ held: 1, equipped: 1 })).toBe(false);
  });

  it('is false at the slot cap even with plenty in reserve', () => {
    expect(canArm({ held: 5, equipped: ARMED_SLOTS })).toBe(false);
  });

  it('is true at one armed with more held', () => {
    expect(canArm({ held: 3, equipped: 1 })).toBe(true);
  });

  it('stays false if the counts ever contradict each other', () => {
    // Two independent queries; `equipped > held` should be impossible, but a
    // predicate that answers "yes, arm another" to nonsense is how one bad
    // read becomes a request loop.
    expect(canArm({ held: 0, equipped: 1 })).toBe(false);
  });
});

describe('canDisarm', () => {
  it('is false with none armed', () => {
    expect(canDisarm({ held: 4, equipped: 0 })).toBe(false);
  });

  it('is true with any armed', () => {
    expect(canDisarm({ held: 1, equipped: 1 })).toBe(true);
    expect(canDisarm({ held: 5, equipped: 2 })).toBe(true);
  });

  it('does not care how many are held', () => {
    // Standing one down is always allowed — it is the undo, and gating it on
    // anything would strand a user who armed one by accident.
    expect(canDisarm({ held: 0, equipped: 1 })).toBe(true);
  });
});

describe('reserveCount', () => {
  it('counts only the unarmed ones', () => {
    expect(reserveCount({ held: 3, equipped: 1 })).toBe(2);
    expect(reserveCount({ held: 2, equipped: 2 })).toBe(0);
  });

  it('never goes negative', () => {
    // "-1 more in reserve" printed in the sheet header is worse than a
    // momentarily optimistic zero.
    expect(reserveCount({ held: 0, equipped: 2 })).toBe(0);
  });
});

describe('the two buttons are never both dead while something is possible', () => {
  it('offers at least one action for every reachable state', () => {
    // A sheet where neither button works is a dead end the user cannot read
    // their way out of. The only states that legitimately offer nothing are
    // "you own no freezes" — which the sheet answers with its own copy.
    for (let held = 0; held <= 5; held += 1) {
      for (let equipped = 0; equipped <= Math.min(held, ARMED_SLOTS); equipped += 1) {
        const counts = { held, equipped };
        const dead = !canArm(counts) && !canDisarm(counts);
        expect({ ...counts, dead }).toEqual({ ...counts, dead: held === 0 });
      }
    }
  });
});

/**
 * What the Account screen says about what you have.
 *
 * The section was headed "Subscription" and said nothing about one: no tier,
 * no renewal, no upgrade. `useIsPremium` appeared exactly once in the entire
 * Profile tree and not here, so a subscriber could not confirm they were
 * subscribed and someone who wanted to pay could not do it from the account
 * area at all.
 *
 * The case worth reading first is `unknown`. Everything else in the app treats
 * a missing entitlement as "free", which is right for a *gate* (fail closed)
 * and wrong for a *label* — and treating unknown as free is precisely how a
 * paying customer gets shown an upgrade pitch.
 */

import type { Entitlements } from '../../../types';
import { formatRenewal, subscriptionStatus } from '../subscriptionStatus';

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  tier: 'free',
  is_premium: false,
  is_admin: false,
  ads_eligible: true,
  subscription_expires_at: null,
  ...over,
});

describe('when the server has not answered yet', () => {
  it('says neither "free" nor "premium"', () => {
    expect(subscriptionStatus(undefined).labelKey).toBe('settings:subscriptionUnknown');
    expect(subscriptionStatus(null).labelKey).toBe('settings:subscriptionUnknown');
  });

  it('does not pitch an upgrade', () => {
    // The whole point. Asking someone to subscribe while you do not yet know
    // whether they already have is the insult this audit started from — it
    // happened for a full session after every sign-in.
    expect(subscriptionStatus(undefined).showUpgrade).toBe(false);
  });

  it('still offers restore', () => {
    // Safe in both directions, and it is the escape hatch for exactly this
    // state: a subscriber whose entitlement did not load.
    expect(subscriptionStatus(undefined).showRestore).toBe(true);
  });
});

describe('a free account', () => {
  const free = subscriptionStatus(ent());

  it('is labelled free and offered the upgrade', () => {
    expect(free.labelKey).toBe('settings:subscriptionFree');
    expect(free.showUpgrade).toBe(true);
  });

  it('is offered restore', () => {
    // A subscriber on a new phone, or after a reinstall, looks exactly like
    // this — so hiding restore here would strand them.
    expect(free.showRestore).toBe(true);
  });

  it('cannot reach the family plan', () => {
    // The screen behind it requires Plus, so a row that leads to "you need
    // Plus" is a row that wastes a tap.
    expect(free.familyPlanAvailable).toBe(false);
  });

  it('shows no renewal date', () => {
    expect(free.expiresAt).toBeNull();
  });
});

describe('a paying account', () => {
  const plus = subscriptionStatus(
    ent({ tier: 'premium', is_premium: true, subscription_expires_at: '2026-12-01T00:00:00Z' }),
  );

  it('is labelled Plus and shows when it renews', () => {
    expect(plus.labelKey).toBe('settings:subscriptionPlus');
    expect(plus.expiresAt).toBe('2026-12-01T00:00:00Z');
  });

  it('is not pitched an upgrade it already has', () => {
    expect(plus.showUpgrade).toBe(false);
  });

  it('is not offered restore', () => {
    // Nothing to restore. The row's only possible outcome was the server
    // replying "your subscription is already active".
    expect(plus.showRestore).toBe(false);
  });

  it('can reach the family plan', () => {
    expect(plus.familyPlanAvailable).toBe(true);
  });
});

describe('the ways of being premium that are worth telling apart', () => {
  it('names a trial, because it will start charging', () => {
    expect(subscriptionStatus(ent({ tier: 'trial', is_premium: true })).labelKey).toBe(
      'settings:subscriptionTrial',
    );
  });

  it('names a comp, because it will not', () => {
    expect(subscriptionStatus(ent({ tier: 'comped', is_premium: true })).labelKey).toBe(
      'settings:subscriptionComped',
    );
  });

  it('shows no renewal for a perpetual purchase', () => {
    // Lifetime writes a null expiry. "Renews: —" invites a support ticket.
    const lifetime = subscriptionStatus(
      ent({ tier: 'premium', is_premium: true, subscription_expires_at: null }),
    );
    expect(lifetime.expiresAt).toBeNull();
  });
});

describe('formatRenewal', () => {
  it('formats in the app language, not the device locale', () => {
    // `toLocaleDateString()` with no argument silently follows the phone,
    // which need not be the language the rest of the screen is in.
    expect(formatRenewal('2026-12-01T00:00:00Z', 'en-US')).toContain('2026');
    expect(formatRenewal('2026-12-01T00:00:00Z', 'en-US')).not.toEqual(
      formatRenewal('2026-12-01T00:00:00Z', 'ru-RU'),
    );
  });

  it('returns null when there is nothing to show', () => {
    expect(formatRenewal(null, 'en-US')).toBeNull();
  });

  it('survives a date it cannot parse', () => {
    // A malformed timestamp must not take the row down with it.
    expect(formatRenewal('not-a-date', 'en-US')).toBeNull();
  });

  it('survives a locale tag it does not know', () => {
    expect(formatRenewal('2026-12-01T00:00:00Z', 'zz-ZZ-nonsense')).toBeTruthy();
  });
});

/**
 * subscriptionStatus — what the Account screen says about what you have.
 *
 * ## Why this did not exist
 *
 * `useIsPremium` appeared exactly once in the whole Profile tree, inside
 * FamilyPlanScreen. The Account screen — whose section header is the word
 * "Subscription" — offered Family Plan and Restore Purchases and nothing else:
 * no tier, no renewal date, no upgrade. So a subscriber had no way to confirm
 * they were subscribed, and someone who wanted to pay had no way to do it from
 * the account area at all. The paywall was reachable only by being turned away
 * from something mid-session, which is the one moment a person is least
 * inclined to read it.
 *
 * A pure function because the mobile suite is logic-only: a sentence chosen
 * inside JSX is a sentence nothing can check. Same reasoning as
 * `paywallPricing.paywallSubtitle`.
 */

import type { Entitlements } from '../../types';

export interface SubscriptionStatus {
  /** i18n key for the row's value, under the `settings` namespace. */
  labelKey: string;
  /** ISO date to render under the row, when there is a real renewal to show. */
  expiresAt: string | null;
  /** Whether to offer the upgrade CTA. */
  showUpgrade: boolean;
  /** Whether "Restore purchases" is worth offering. */
  showRestore: boolean;
  /** Whether the Family Plan row can do anything yet. */
  familyPlanAvailable: boolean;
}

/**
 * Describe an account's subscription.
 *
 * `null` entitlements means the server has not told us yet — which is NOT the
 * same as "free", and the distinction is the whole reason this takes the
 * nullable type. Treating unknown as free is what made a paying subscriber see
 * an upgrade pitch for a session after signing in; here it renders a neutral
 * "checking" row instead of asserting either answer.
 */
export function subscriptionStatus(ent: Entitlements | null | undefined): SubscriptionStatus {
  if (!ent) {
    return {
      labelKey: 'settings:subscriptionUnknown',
      expiresAt: null,
      // No upgrade pitch on an unknown tier: showing one to someone who may
      // already be paying is the exact insult this audit started from.
      showUpgrade: false,
      showRestore: true,
      familyPlanAvailable: false,
    };
  }

  if (!ent.is_premium) {
    return {
      labelKey: 'settings:subscriptionFree',
      expiresAt: null,
      showUpgrade: true,
      // The point of Restore for a free-reading account: a subscriber on a new
      // phone, or after a reinstall, lands here looking exactly like this.
      showRestore: true,
      familyPlanAvailable: false,
    };
  }

  // Premium, in one of three ways that are worth telling apart — a trial that
  // will start charging, a comp that never will, and an ordinary subscription.
  const labelKey =
    ent.tier === 'trial'
      ? 'settings:subscriptionTrial'
      : ent.tier === 'comped'
        ? 'settings:subscriptionComped'
        : 'settings:subscriptionPlus';

  return {
    labelKey,
    // A perpetual (lifetime) purchase has no expiry, and printing "Renews: —"
    // for it invites a support ticket.
    expiresAt: ent.subscription_expires_at,
    showUpgrade: false,
    // Nothing to restore when the account already has it. The server says so
    // plainly ("Your subscription is already active"), so the row would only
    // ever be a way to read that sentence.
    showRestore: false,
    familyPlanAvailable: true,
  };
}

/**
 * Format a renewal date for display, or null when there is nothing to show.
 *
 * Uses the app language rather than the device locale — `toLocaleDateString`
 * with no argument silently follows the phone, which is not necessarily the
 * language the rest of this screen is in.
 */
export function formatRenewal(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  try {
    return when.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    // An unsupported locale tag must not take the row down with it.
    return when.toISOString().slice(0, 10);
  }
}

/**
 * Paywall pricing + copy (States §D). Pure data/logic so the savings badge is
 * derived from the real prices (not a hard-coded mock number) and unit-tested.
 *
 * Prices are USD fallbacks used for the savings math + default display; the
 * live, localized price strings come from the store via billing.getProducts().
 */

export const MONTHLY_PRICE_USD = 4.99;
export const ANNUAL_PRICE_USD = 29.99;

export const MONTHLY_PRICE_LABEL = '$4.99';
export const ANNUAL_PRICE_LABEL = '$29.99';

/** Annual savings vs paying monthly for a year, as a whole percent. */
export function annualSavingsPercent(
  monthly: number = MONTHLY_PRICE_USD,
  annual: number = ANNUAL_PRICE_USD,
): number {
  if (monthly <= 0) return 0;
  return Math.round((1 - annual / (monthly * 12)) * 100);
}

export interface PaywallFeature {
  icon: string;
  title: string;
  desc: string;
}

export const PAYWALL_FEATURES: ReadonlyArray<PaywallFeature> = [
  { icon: '🧠', title: 'Unlimited SRS reviews', desc: 'Review all your saved words with spaced repetition — no session limits.' },
  { icon: '🎬', title: 'Unlimited reels', desc: 'Add as many films as you like and analyze every script.' },
  { icon: '🚫', title: 'No ads', desc: 'A clean, distraction-free learning experience.' },
  { icon: '📊', title: 'Detailed stats', desc: 'Track retention and comprehension over time.' },
];

// ── Why the user is looking at this screen ─────────────────────────────────
//
// `/srs/session/start` answers 402 for two different reasons and the screen
// needs a different sentence for each. It used to have neither: the subtitle
// was hard-coded to "You've used {used} of {limit} free review sessions", and
// the daily-cap payload carries no counts, so the client's `?? 0` fallbacks
// put **"You've used 0 of 0 free review sessions"** in front of every free
// user who finished today's Practice lesson and tapped the coin again. That
// is the app's entire monetisation surface, reached from its most-used tab.
//
// Keeping the decision here, rather than inline in the component, is what
// lets it be tested at all — the mobile suite is logic-only by policy, so a
// sentence chosen inside JSX is a sentence nothing can check.

/** Why the paywall opened. `null` for the entry points that are just
 *  browsing the upgrade (a Settings tap, an upsell row) rather than being
 *  turned away from something. */
export type PaywallReason = 'daily_cap_reached' | 'preview_exhausted' | null;

export interface PaywallSubtitle {
  /** i18n key under the `billing` namespace. */
  key: string;
  /** Interpolation values, if the chosen string takes any. */
  params?: Record<string, number>;
}

/**
 * Pick the subtitle for the paywall.
 *
 * `daily_cap_reached` deliberately takes no counts: the budget is one
 * session per UTC day and "1 of 1" reads like a quota the user could have
 * spent differently. "You've done today's review" is the true statement,
 * and it is the one that makes the upgrade legible — what Plus buys is the
 * *next* session, today.
 */
export function paywallSubtitle(
  reason: PaywallReason,
  previewsUsed: number,
  previewsLimit: number,
): PaywallSubtitle {
  if (reason === 'daily_cap_reached') {
    return { key: 'billing:paywall.subDailyCap' };
  }
  // The legacy preview budget. Only render the count when it is coherent —
  // a zero limit means the server sent nothing useful, and "0 of 0" is
  // worse than saying nothing at all.
  if (reason === 'preview_exhausted' && previewsLimit > 0) {
    return {
      key: 'billing:paywall.subPreviews',
      params: { used: Math.min(previewsUsed, previewsLimit), limit: previewsLimit },
    };
  }
  return { key: 'billing:paywall.subGeneric' };
}

/**
 * Paywall pricing + copy (States §D). Pure data/logic so the savings badge is
 * derived from the real prices (not a hard-coded mock number) and unit-tested.
 *
 * Prices are USD fallbacks used for the savings math + default display; the
 * live, localized price strings come from the store via billing.getProducts().
 */

export const MONTHLY_PRICE_USD = 4.99;
/**
 * Annual, raised from 29.99 on 2026-09-12.
 *
 * 29.99 was a 50% discount on twelve months — steeper than the category norm
 * of roughly 30–40%, and steeper than it needed to be. The annual plan is
 * already the default, already carries the savings badge, and is what almost
 * everyone picks for that reason rather than for the size of the number; the
 * extra 20 points of discount bought very little conversion and cost real
 * money on every subscriber. 34.99 keeps the badge comfortably in the
 * "obviously the better deal" range (~42%) while giving back a third of the
 * gap.
 */
export const ANNUAL_PRICE_USD = 34.99;
/**
 * One payment, no renewal.
 *
 * Exists for the segment that will not start a subscription at any price — a
 * real and stubborn group, and one that otherwise contributes nothing. It also
 * pays now rather than over twelve months, which matters far more early than
 * lifetime-value arithmetic does.
 *
 * Priced at a bit over two years of annual: high enough that it does not
 * cannibalise renewals from people who would have stayed, low enough to read
 * as a decision rather than a splurge.
 */
export const LIFETIME_PRICE_USD = 79.99;

export const MONTHLY_PRICE_LABEL = '$4.99';
export const ANNUAL_PRICE_LABEL = '$34.99';
export const LIFETIME_PRICE_LABEL = '$79.99';

/** Annual savings vs paying monthly for a year, as a whole percent. */
export function annualSavingsPercent(
  monthly: number = MONTHLY_PRICE_USD,
  annual: number = ANNUAL_PRICE_USD,
): number {
  if (monthly <= 0) return 0;
  return Math.round((1 - annual / (monthly * 12)) * 100);
}

/** Which drawn icon a feature row shows. A name, not a glyph: these were
 *  🧠 🎬 🚫 📊, four system emoji sitting in the one screen that asks for
 *  money, each drawn by the OS in a font we do not control and none of them
 *  matching the app's palette. */
export type PaywallFeatureIcon = 'brain' | 'film' | 'block' | 'chart' | 'shield';

export interface PaywallFeature {
  icon: PaywallFeatureIcon;
  title: string;
  desc: string;
}

export const PAYWALL_FEATURES: ReadonlyArray<PaywallFeature> = [
  { icon: 'brain', title: 'Unlimited SRS reviews', desc: 'Review all your saved words with spaced repetition — no session limits.' },
  { icon: 'film',  title: 'Unlimited reels', desc: 'Add as many films as you like and analyze every script.' },
  // The row the freeze sheet's locked slot promises. Without it, a user who
  // taps "Plus covers two days in a row" lands on a page that never mentions
  // freezes — an upsell that forgets its own pitch between the tap and the
  // screen.
  { icon: 'shield', title: 'Two streak freezes armed', desc: 'Cover two missed days in a row instead of one.' },
  { icon: 'block', title: 'No ads', desc: 'A clean, distraction-free learning experience.' },
  { icon: 'chart', title: 'Detailed stats', desc: 'Track retention and comprehension over time.' },
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

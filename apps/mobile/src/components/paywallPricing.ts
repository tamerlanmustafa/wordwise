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

import {
  annualSavingsPercent,
  MONTHLY_PRICE_USD,
  ANNUAL_PRICE_USD,
  PAYWALL_FEATURES,
} from '../paywallPricing';

describe('annualSavingsPercent', () => {
  it('computes the real savings from the default prices', () => {
    // 29.99 vs 4.99×12 = 59.88 → ~50%.
    expect(annualSavingsPercent()).toBe(50);
  });

  it('rounds to a whole percent', () => {
    expect(annualSavingsPercent(5, 36)).toBe(40); // 1 - 36/60 = 0.40
    expect(annualSavingsPercent(5, 30)).toBe(50);
  });

  it('never divides by zero', () => {
    expect(annualSavingsPercent(0, 30)).toBe(0);
  });

  it('default prices are sane (annual cheaper than a year of monthly)', () => {
    expect(ANNUAL_PRICE_USD).toBeLessThan(MONTHLY_PRICE_USD * 12);
  });
});

describe('PAYWALL_FEATURES', () => {
  it('lists premium features with title + description', () => {
    expect(PAYWALL_FEATURES.length).toBeGreaterThan(0);
    PAYWALL_FEATURES.forEach((f) => {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.desc.length).toBeGreaterThan(0);
    });
  });
});

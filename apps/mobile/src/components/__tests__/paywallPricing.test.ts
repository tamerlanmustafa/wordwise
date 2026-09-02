import {
  paywallSubtitle,
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

describe('paywallSubtitle', () => {
  // The bug this exists to stop: `/srs/session/start` answers 402 for two
  // different reasons, and the screen had one hard-coded sentence about the
  // legacy preview budget. The daily-cap payload carries no counts, so the
  // client's `?? 0` fallbacks rendered **"You've used 0 of 0 free review
  // sessions"** — on the app's only monetisation surface, reached by tapping
  // the Practice coin a second time in a day, which is the single most
  // common way a free user meets the paywall at all.

  it('never claims a budget the daily cap does not have', () => {
    const sub = paywallSubtitle('daily_cap_reached', 0, 0);

    expect(sub.key).toBe('billing:paywall.subDailyCap');
    expect(sub.params).toBeUndefined();
  });

  it('ignores counts even when the server does send them', () => {
    // The backend now fills in 1/1 so already-installed builds render
    // something true. Newer builds key off the reason and say it in words.
    expect(paywallSubtitle('daily_cap_reached', 1, 1).key)
      .toBe('billing:paywall.subDailyCap');
  });

  it('reports the legacy preview budget when there is a real one', () => {
    const sub = paywallSubtitle('preview_exhausted', 3, 3);

    expect(sub.key).toBe('billing:paywall.subPreviews');
    expect(sub.params).toEqual({ used: 3, limit: 3 });
  });

  it('drops the count rather than printing "0 of 0"', () => {
    // A zero limit means the server sent nothing useful. Saying nothing
    // beats saying a number that reads as a bug.
    expect(paywallSubtitle('preview_exhausted', 0, 0).key)
      .toBe('billing:paywall.subGeneric');
  });

  it('never shows a used count above the limit', () => {
    expect(paywallSubtitle('preview_exhausted', 9, 3).params)
      .toEqual({ used: 3, limit: 3 });
  });

  it('has a sentence for the entry points that are just browsing', () => {
    // Settings and upsell rows open the paywall with no 402 behind them.
    expect(paywallSubtitle(null, 0, 0).key).toBe('billing:paywall.subGeneric');
  });
});

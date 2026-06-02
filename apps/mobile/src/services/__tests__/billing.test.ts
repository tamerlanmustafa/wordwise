// expo-in-app-purchases isn't available outside a dev client, so the billing
// scaffold must degrade to safe no-ops everywhere. This locks that contract so
// the app never crashes on a build that lacks the native IAP module.
jest.mock('../api', () => ({
  billingApi: {
    verifyAppleReceipt: jest.fn(),
    verifyGoogleReceipt: jest.fn(),
    restorePurchases: jest.fn(),
  },
}));

import {
  PRODUCTS,
  initializeBilling,
  getProducts,
  purchaseProduct,
  restorePurchases,
  disconnectBilling,
  setPurchaseListener,
} from '../billing';
import { billingApi } from '../api';

const mockServerRestore = billingApi.restorePurchases as jest.Mock;

describe('billing scaffold (no native IAP module)', () => {
  it('exposes the monthly + annual product ids', () => {
    expect(PRODUCTS.MONTHLY).toBe('com.wordwise.plus.monthly');
    expect(PRODUCTS.ANNUAL).toBe('com.wordwise.plus.annual');
  });

  it('initializeBilling resolves quietly', async () => {
    await expect(initializeBilling()).resolves.toBeUndefined();
  });

  it('getProducts returns an empty catalog when not connected', async () => {
    await expect(getProducts()).resolves.toEqual([]);
  });

  it('purchaseProduct returns false when billing is unavailable', async () => {
    await expect(purchaseProduct(PRODUCTS.MONTHLY)).resolves.toBe(false);
  });

  it('setPurchaseListener returns a callable unsubscribe and does not throw', () => {
    const unsubscribe = setPurchaseListener(() => {});
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });

  it('restorePurchases returns the server result immediately when it restores a subscription', async () => {
    mockServerRestore.mockResolvedValueOnce({ restored: true, message: 'Subscription restored!' });
    await expect(restorePurchases()).resolves.toEqual({ restored: true, message: 'Subscription restored!' });
  });

  it('restorePurchases falls through to the native path (unavailable) when the server finds nothing', async () => {
    mockServerRestore.mockResolvedValueOnce({ restored: false, message: 'No active subscription found.' });
    await expect(restorePurchases()).resolves.toEqual({
      restored: false,
      message: 'Billing not available in this build.',
    });
  });

  it('restorePurchases survives a throwing server call and still reports unavailable', async () => {
    mockServerRestore.mockRejectedValueOnce(new Error('network'));
    await expect(restorePurchases()).resolves.toMatchObject({ restored: false });
  });

  it('disconnectBilling resolves quietly', async () => {
    await expect(disconnectBilling()).resolves.toBeUndefined();
  });
});

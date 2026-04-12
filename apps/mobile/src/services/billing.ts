/**
 * In-app purchase scaffold for StoreKit (iOS) and Google Play Billing (Android).
 *
 * SETUP REQUIRED:
 *   1. Install: npx expo install expo-in-app-purchases
 *   2. Build a dev client (not Expo Go): npx expo prebuild && npx expo run:ios
 *   3. Configure products in App Store Connect / Google Play Console
 *   4. Set APPLE_SHARED_SECRET env var on the backend
 *   5. Set GOOGLE_PLAY_CREDENTIALS_PATH env var on the backend
 *
 * All functions are safe no-ops if the native module isn't available (Expo Go).
 */

import { Platform } from 'react-native';
import { billingApi } from './api';

let IAP: any = null;

try {
  IAP = require('expo-in-app-purchases');
} catch {
  console.warn('[billing] expo-in-app-purchases not available (needs dev client)');
}

export const PRODUCTS = {
  MONTHLY: 'com.wordwise.plus.monthly',
  ANNUAL: 'com.wordwise.plus.annual',
} as const;

export type ProductId = (typeof PRODUCTS)[keyof typeof PRODUCTS];

export interface ProductInfo {
  productId: string;
  title: string;
  description: string;
  price: string;
  priceAmountMicros?: number;
  currencyCode?: string;
}

let isConnected = false;

export async function initializeBilling(): Promise<void> {
  if (!IAP || isConnected) return;
  try {
    await IAP.connectAsync();
    isConnected = true;
  } catch (e) {
    console.warn('[billing] connect failed:', e);
  }
}

export async function getProducts(): Promise<ProductInfo[]> {
  if (!IAP || !isConnected) return [];
  try {
    const { results } = await IAP.getProductsAsync([PRODUCTS.MONTHLY, PRODUCTS.ANNUAL]);
    return (results || []).map((p: any) => ({
      productId: p.productId,
      title: p.title,
      description: p.description,
      price: p.price,
      priceAmountMicros: p.priceAmountMicros,
      currencyCode: p.priceCurrencyCode,
    }));
  } catch (e) {
    console.warn('[billing] getProducts failed:', e);
    return [];
  }
}

export async function purchaseProduct(productId: ProductId): Promise<boolean> {
  if (!IAP || !isConnected) {
    console.warn('[billing] Not connected — purchase unavailable');
    return false;
  }
  try {
    await IAP.purchaseItemAsync(productId);
    return true;
  } catch (e: any) {
    if (e.code === 'E_USER_CANCELLED') return false;
    console.warn('[billing] purchase failed:', e);
    return false;
  }
}

export function setPurchaseListener(
  onPurchase: (result: { productId: string; acknowledged: boolean }) => void
): () => void {
  if (!IAP) return () => {};

  const subscription = IAP.setPurchaseListener(async ({ responseCode, results }: any) => {
    if (responseCode === IAP!.IAPResponseCode.OK && results) {
      for (const purchase of results) {
        if (!purchase.acknowledged) {
          await IAP!.finishTransactionAsync(purchase, true);
        }

        // Verify receipt server-side
        try {
          if (Platform.OS === 'ios') {
            await billingApi.verifyAppleReceipt(
              purchase.transactionReceipt || '',
              purchase.productId,
            );
          } else {
            await billingApi.verifyGoogleReceipt(
              purchase.purchaseToken || '',
              purchase.productId,
            );
          }
        } catch (e) {
          console.warn('[billing] server verification failed:', e);
        }

        onPurchase({
          productId: purchase.productId,
          acknowledged: purchase.acknowledged,
        });
      }
    }
  });

  return () => {
    // expo-in-app-purchases setPurchaseListener returns void, not a subscription
    // cleanup by disconnecting
  };
}

export async function restorePurchases(): Promise<{
  restored: boolean;
  message: string;
}> {
  // First try server-side restore
  try {
    const result = await billingApi.restorePurchases();
    if (result.restored) return result;
  } catch {}

  // Then try native restore
  if (!IAP || !isConnected) {
    return { restored: false, message: 'Billing not available in this build.' };
  }

  try {
    const { results } = await IAP.getPurchaseHistoryAsync();
    if (results && results.length > 0) {
      const latest = results[results.length - 1];
      try {
        if (Platform.OS === 'ios') {
          const status = await billingApi.verifyAppleReceipt(
            latest.transactionReceipt || '',
            latest.productId,
          );
          if (status.is_premium) {
            return { restored: true, message: 'Subscription restored!' };
          }
        }
      } catch {}
    }
    return { restored: false, message: 'No active subscription found.' };
  } catch (e) {
    console.warn('[billing] restore failed:', e);
    return { restored: false, message: 'Restore failed. Please try again.' };
  }
}

export async function disconnectBilling(): Promise<void> {
  if (!IAP || !isConnected) return;
  try {
    await IAP.disconnectAsync();
    isConnected = false;
  } catch {}
}

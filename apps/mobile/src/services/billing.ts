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
  /** Non-consumable, not a subscription: bought once and never renews. Both
   *  stores treat that as a different product type, so it needs its own id
   *  and its own entry in App Store Connect / Play Console. */
  LIFETIME: 'com.wordwise.plus.lifetime',
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

  // Not captured: expo-in-app-purchases' setPurchaseListener returns void, so
  // there is no subscription object to hold. The assignment was dead and lint
  // had been calling it out; the cleanup below says what actually happens.
  IAP.setPurchaseListener(async ({ responseCode, results }: any) => {
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

export interface RestoreOutcome {
  restored: boolean;
  /** The server's own sentence, when it sent one. Already in English. */
  message: string;
  /** i18n key to prefer over `message`. See the note below. */
  messageKey?: string;
}

/**
 * Restore a purchase made on another device, or before a reinstall.
 *
 * ## Three things were wrong here
 *
 * **The server's answer was thrown away.** `/billing/restore` returns
 * `restored: false` for an active subscriber too, carrying the genuinely
 * useful "Your subscription is already active." The old code checked only the
 * boolean, so it fell straight through to the native path and reported
 * "Billing not available in this build" — to a paying customer.
 *
 * **Android could never succeed.** The native branch verified receipts under
 * `Platform.OS === 'ios'` only, so an Android user with a real purchase fell
 * past it to "No active subscription found" every time.
 *
 * **The messages were hardcoded English** under a title that was translated,
 * so a Russian user got "Не найдено" above an English sentence. They are i18n
 * keys now; `message` survives only for the server's own prose, which is the
 * one string this app genuinely cannot translate on the client.
 */
export async function restorePurchases(): Promise<RestoreOutcome> {
  // Ask the server first: it is the only party that knows whether *this
  // account* is already entitled, regardless of which store the purchase came
  // from or which device is asking.
  try {
    const result = await billingApi.restorePurchases();
    // Not `if (result.restored)`. An already-premium account comes back false
    // with the most useful message of the three, and discarding it is what
    // told subscribers their billing was broken.
    if (result.restored || result.tier === 'premium') {
      return { restored: result.restored, message: result.message };
    }
  } catch {
    // Offline, or the endpoint is down. The native path below can still
    // answer from the store's own records.
  }

  if (!IAP || !isConnected) {
    return {
      restored: false,
      message: 'Billing not available in this build.',
      messageKey: 'billing:paywall.restoreUnavailable',
    };
  }

  try {
    const { results } = await IAP.getPurchaseHistoryAsync();
    if (results && results.length > 0) {
      const latest = results[results.length - 1];
      try {
        // Both platforms, not just iOS. Each store hands back a different
        // credential — a receipt blob on Apple, a purchase token on Google —
        // which is why this is a branch and not one call.
        const status =
          Platform.OS === 'ios'
            ? await billingApi.verifyAppleReceipt(
                latest.transactionReceipt || '',
                latest.productId,
              )
            : await billingApi.verifyGoogleReceipt(
                latest.purchaseToken || '',
                latest.productId,
              );
        if (status.is_premium) {
          return {
            restored: true,
            message: 'Subscription restored!',
            messageKey: 'billing:paywall.restoreSucceeded',
          };
        }
      } catch (e) {
        console.warn('[billing] receipt verification failed:', e);
      }
    }
    return {
      restored: false,
      message: 'No active subscription found.',
      messageKey: 'billing:paywall.restoreNotFound',
    };
  } catch (e) {
    console.warn('[billing] restore failed:', e);
    return {
      restored: false,
      message: 'Restore failed. Please try again.',
      messageKey: 'billing:paywall.restoreFailed',
    };
  }
}

export async function disconnectBilling(): Promise<void> {
  if (!IAP || !isConnected) return;
  try {
    await IAP.disconnectAsync();
    isConnected = false;
  } catch {}
}

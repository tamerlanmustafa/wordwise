/**
 * AdMob scaffold for banner and rewarded video ads.
 *
 * SETUP REQUIRED:
 *   1. Create an AdMob account at https://admob.google.com
 *   2. Create ad unit IDs for banner and rewarded video
 *   3. Install: npx expo install expo-ads-admob
 *   4. Add your AdMob app ID to app.json:
 *      "expo": {
 *        "plugins": [
 *          ["expo-ads-admob", { "userTrackingPermission": "..." }]
 *        ],
 *        "ios": { "config": { "googleMobileAdsAppId": "ca-app-pub-XXXX~XXXX" } },
 *        "android": { "config": { "googleMobileAdsAppId": "ca-app-pub-XXXX~XXXX" } }
 *      }
 *   5. Replace the test ad unit IDs below with your real ones
 *   6. Build a dev client (not Expo Go)
 *
 * All functions are safe no-ops if the native module isn't available.
 */

import { Platform } from 'react-native';

let AdMob: any = null;

try {
  AdMob = require('expo-ads-admob');
} catch {
  console.warn('[ads] expo-ads-admob not available (needs dev client)');
}

// Test ad unit IDs — replace with real ones from your AdMob dashboard
const AD_UNIT_IDS = {
  banner: Platform.select({
    ios: 'ca-app-pub-3940256099942544/2934735716',     // Test
    android: 'ca-app-pub-3940256099942544/6300978111',  // Test
  }) || '',
  rewarded: Platform.select({
    ios: 'ca-app-pub-3940256099942544/1712485313',      // Test
    android: 'ca-app-pub-3940256099942544/5224354917',   // Test
  }) || '',
};

let adsInitialized = false;

export async function initializeAds(): Promise<void> {
  if (!AdMob || adsInitialized) return;
  try {
    await AdMob.setTestDeviceIDAsync?.('EMULATOR');
    adsInitialized = true;
  } catch (e) {
    console.warn('[ads] init failed:', e);
  }
}

export function getBannerAdUnitId(): string {
  return AD_UNIT_IDS.banner;
}

export function getRewardedAdUnitId(): string {
  return AD_UNIT_IDS.rewarded;
}

export async function showRewardedAd(): Promise<boolean> {
  if (!AdMob) {
    console.warn('[ads] AdMob not available');
    return false;
  }

  try {
    await AdMob.AdMobRewarded.setAdUnitID(AD_UNIT_IDS.rewarded);
    await AdMob.AdMobRewarded.requestAdAsync();
    await AdMob.AdMobRewarded.showAdAsync();
    return true;
  } catch (e: any) {
    if (e.code === 'E_AD_NOT_READY') {
      console.warn('[ads] Rewarded ad not ready');
    } else {
      console.warn('[ads] showRewardedAd failed:', e);
    }
    return false;
  }
}

export function setRewardedAdListener(
  onRewarded: () => void,
  onClosed: () => void,
): () => void {
  if (!AdMob) return () => {};

  const rewardSub = AdMob.AdMobRewarded.addEventListener?.('rewardedVideoDidRewardUser', onRewarded);
  const closeSub = AdMob.AdMobRewarded.addEventListener?.('rewardedVideoDidClose', onClosed);

  return () => {
    rewardSub?.remove?.();
    closeSub?.remove?.();
  };
}

/**
 * AdMobBanner component export.
 * Usage in React: <AdBanner />
 * Returns null if AdMob is not available.
 */
export function getAdBannerComponent(): any | null {
  if (!AdMob) return null;
  return AdMob.AdMobBanner || null;
}

export { AD_UNIT_IDS };

/**
 * useGlassAvailable — may this surface render iOS 26 Liquid Glass right now?
 *
 * Three independent things all have to be true, and they fail in different
 * ways, so they are checked separately rather than collapsed into one guess:
 *
 *   1. `isLiquidGlassAvailable()` — the app was built against the iOS 26 SDK
 *      and has not opted out via `UIDesignRequiresCompatibility`. False on
 *      Android and on every iOS below 26, where the module's fallback build
 *      returns false without touching native code.
 *   2. `isGlassEffectAPIAvailable()` — the underlying UIKit API actually
 *      exists. Some iOS 26 betas shipped without it and *crash* if you render
 *      a GlassView, which is why Expo added a second, narrower check.
 *   3. Reduce Transparency is off. This one is a user preference, not a
 *      capability: `isLiquidGlassAvailable()` stays true when someone has
 *      turned it on, so honouring it is on us. It is also the only one of the
 *      three that can change while the app is open, hence the subscription.
 *
 * Anything false means the caller should draw its opaque fallback. Returning a
 * plain boolean keeps that decision at the call site instead of scattering
 * three checks through the component tree.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';

/** Static half of the check — safe to evaluate once at module scope. */
const GLASS_SUPPORTED =
  Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function useGlassAvailable(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    if (!GLASS_SUPPORTED) return;
    let alive = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((on) => {
        if (alive) setReduceTransparency(on);
      })
      // An unavailable accessibility bridge shouldn't cost us the glass; the
      // default (false) is the right guess when we genuinely cannot tell.
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return GLASS_SUPPORTED && !reduceTransparency;
}

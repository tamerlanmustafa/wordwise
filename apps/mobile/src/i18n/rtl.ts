/**
 * RTL layout support.
 *
 * React Native mirrors layout at the *native* level, not per-render: Yoga reads
 * `I18nManager.isRTL` once when the bridge starts, so flipping it mid-session
 * leaves a half-mirrored UI. The flow is therefore always two steps —
 * `syncRtlLayout()` records the desired direction, and the caller reloads the
 * app when it reports a change.
 *
 * What Yoga mirrors for free once `isRTL` is true:
 *   • `flexDirection: 'row'`      → visually right-to-left
 *   • `marginStart/End`, `paddingStart/End`, `borderStart/EndWidth`
 *   • `start` / `end` in absolute positioning
 *
 * What it does *not* mirror, and this module exists to handle:
 *   • `marginLeft/Right` and friends — physical, never flip. Use the logical
 *     properties everywhere; `__tests__/rtl.test.ts` fails the build if a new
 *     physical edge appears in a StyleSheet.
 *   • `textAlign: 'left' | 'right'` — physical. Use `alignStart` / `alignEnd`.
 *   • Glyphs that point somewhere: back chevrons, `Continue →`. Use
 *     `directionalIcon()` and `FORWARD_ARROW` / `BACK_ARROW`.
 */

import { I18nManager } from 'react-native';

import { getUiLanguage } from './languages';

/** True when the *native layout* is currently mirrored. */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}

/** True when the given UI language code is written right-to-left. */
export function isRtlLanguage(code: string | null | undefined): boolean {
  return getUiLanguage(code)?.rtl === true;
}

/**
 * Align the native layout direction with a UI language.
 *
 * Returns true when the direction actually changed, which means the caller must
 * reload the app for it to take effect. Returning a boolean rather than
 * reloading here keeps the decision with the caller: at cold start we can
 * reload silently, but a change made in Settings deserves a prompt first.
 *
 * `allowRTL(true)` is unconditional and permanent — it only lifts the native
 * opt-out. `forceRTL` is what actually picks the direction, and we set it in
 * both directions so switching *away* from Arabic un-mirrors the app.
 */
export function syncRtlLayout(code: string | null | undefined): boolean {
  const shouldBeRtl = isRtlLanguage(code);

  I18nManager.allowRTL(true);
  if (I18nManager.isRTL === shouldBeRtl) return false;

  I18nManager.forceRTL(shouldBeRtl);
  return true;
}

/**
 * Restart the JS bundle so a direction change takes effect.
 *
 * expo-updates is a native module: required lazily and guarded so Jest and Expo
 * Go degrade to a no-op rather than throwing. Returns false when the reload
 * could not be performed, so callers can fall back to asking the user to
 * restart the app by hand.
 */
export async function reloadForRtl(): Promise<boolean> {
  try {
    const Updates = require('expo-updates');
    if (typeof Updates?.reloadAsync !== 'function') return false;
    await Updates.reloadAsync();
    return true;
  } catch {
    return false;
  }
}

// ─── Style helpers ────────────────────────────────────────────────────────────
//
// RN has no `textAlign: 'start' | 'end'`, so text alignment cannot be expressed
// logically in a StyleSheet. These constants are evaluated once at module load,
// which is correct precisely because a direction change always reloads the
// bundle — there is no session in which `isRTL` changes under a live StyleSheet.

/** `textAlign` that hugs the leading edge — left in LTR, right in RTL. */
export const alignStart: 'left' | 'right' = I18nManager.isRTL ? 'right' : 'left';

/** `textAlign` that hugs the trailing edge — right in LTR, left in RTL. */
export const alignEnd: 'left' | 'right' = I18nManager.isRTL ? 'left' : 'right';

/** `flexDirection` for rows that must keep their visual order under RTL —
 *  number lines, progress bars, media transport controls. */
export const rowFixed: 'row' | 'row-reverse' = I18nManager.isRTL ? 'row-reverse' : 'row';

/**
 * Multiplier between *logical* and *physical* horizontal displacement.
 *
 * Gestures and transforms are the one part of the layout Yoga does not mirror:
 * `PanResponder`'s `dx` and `transform: translateX` are always physical screen
 * pixels, so a swipe handler written against raw `dx` keeps its LTR direction
 * under RTL while everything around it flips.
 *
 * Multiplying converts in both directions — `dx * directionSign` is positive
 * whenever the finger moves toward the *trailing* edge, and multiplying a
 * logical offset back by it produces the physical `translateX` to render.
 */
export const directionSign: 1 | -1 = I18nManager.isRTL ? -1 : 1;

/** Ionicons whose glyph points somewhere, and their mirror image. */
const MIRRORED_ICONS: Readonly<Record<string, string>> = {
  'chevron-back': 'chevron-forward',
  'chevron-forward': 'chevron-back',
  'chevron-back-outline': 'chevron-forward-outline',
  'chevron-forward-outline': 'chevron-back-outline',
  'arrow-back': 'arrow-forward',
  'arrow-forward': 'arrow-back',
  'arrow-undo': 'arrow-redo',
  'arrow-redo': 'arrow-undo',
};

/**
 * Mirror a directional icon name under RTL.
 *
 * Pass every navigational chevron through this. Non-directional names are
 * returned untouched, so it is safe to apply blanket-style at a call site whose
 * icon name is dynamic.
 */
export function directionalIcon<T extends string>(name: T): T {
  if (!I18nManager.isRTL) return name;
  return (MIRRORED_ICONS[name] ?? name) as T;
}

/** Arrow glyph meaning "onward" — flips to `←` under RTL. */
export const FORWARD_ARROW: string = I18nManager.isRTL ? '←' : '→';

/** Arrow glyph meaning "back" — flips to `→` under RTL. */
export const BACK_ARROW: string = I18nManager.isRTL ? '→' : '←';

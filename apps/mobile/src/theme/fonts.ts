/**
 * Font families — the app ships no custom fonts, so we map the prototype's
 * "Source Serif 4 / JetBrains Mono" intent onto the platform defaults the app
 * already uses (SetIntroScreen, etc. use Georgia for serif). Import these
 * instead of re-deriving the Platform.select in every component.
 *
 * None of those four faces carries Arabic glyphs. Left alone, the OS
 * substitutes per *glyph*, so a headline mixing Latin and Arabic renders in two
 * different typefaces. Under RTL we therefore hand the whole string to the
 * system face deliberately (#104 §5): the serif/mono intent is lost either way,
 * and this way it is lost consistently rather than word by word. Read once at
 * module load, like the constants in `i18n/rtl.ts` — a direction change always
 * reloads the bundle, so there is no session in which this goes stale.
 */

import { I18nManager, Platform } from 'react-native';

/** Serif display — headlines, the placement word, big level labels. */
export const SERIF_FAMILY: string | undefined = I18nManager.isRTL
  ? undefined
  : (Platform.select({
      ios: 'Georgia',
      android: 'serif',
      default: 'Georgia',
    }) as string);

/**
 * Serif italic — the definition/gloss lines, which are set italic to read as
 * commentary on the headword rather than as a second sentence.
 *
 * A separate family because Georgia's italic is barely slanted: at the 12pt the
 * deck's gloss slot runs it reads as roman, which is the whole point of the
 * line lost. Charter's italic is a true cursive one and is unmistakable at that
 * size, while drawing within 1.4% of Georgia's lowercase height — so it can be
 * dropped into a slot laid out for Georgia without re-tuning anything. Android
 * ships no Charter and an unknown family there resolves to Roboto — a sans in
 * the middle of a serif card — so it keeps the system serif, whose italic (Noto
 * Serif Italic) is already distinct enough.
 *
 * NOT Baskerville, which shipped here for a day: its italic is the most
 * beautiful of the iOS set and its x-height is 0.4136 against Georgia's 0.4927,
 * so at one point size it draws 16% shorter than the text around it and 23%
 * shorter than the same line on Android. See X_HEIGHT below.
 *
 * Only ever paired with `fontStyle: 'italic'`; the roman of this family is not
 * the card's text face.
 */
export const SERIF_ITALIC_FAMILY: string | undefined = I18nManager.isRTL
  ? undefined
  : (Platform.select({
      ios: 'Charter',
      android: 'serif',
      default: 'Georgia',
    }) as string);

/** Monospace — the small gold "edge-code"/eyebrow labels. */
export const MONO_FAMILY: string | undefined = I18nManager.isRTL
  ? undefined
  : (Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }) as string);

// ── Apparent size ─────────────────────────────────────────────────────────
//
// `fontSize` is not a size anyone can see. It sets the em box; how big the text
// LOOKS is the x-height, the height of a lowercase letter, and that is a
// property of the face. Two families at the same fontSize differ by however
// much their x-heights differ — which is why one line at `12` can look correct
// on a Samsung S24 and undersized on an iPhone 14 Pro Max with no conditional
// anywhere in the code.
//
// Measured from the font files the platforms actually ship, not from a
// specimen: the iOS numbers come out of the iOS 26 simulator runtime
// (System/Library/Fonts), Noto Serif and Roboto from Google Fonts. x-height ÷
// unitsPerEm, read from OS/2 `sxHeight` where present and from the 'x' glyph's
// own bounding box otherwise.
//
//   Noto Serif Italic  0.5360   Android `serif`
//   Roboto             0.5283   Android system face
//   SF                 0.5078   iOS system face
//   Georgia Italic     0.4927   iOS SERIF_FAMILY
//   Charter Italic     0.4858   iOS SERIF_ITALIC_FAMILY
//   Baskerville Italic 0.4136   ← the one that caused this block to exist
//
// Note the standing 8% gap between the serif column on iOS (Georgia) and on
// Android (Noto Serif): every serif line in the app draws slightly smaller on
// iPhone than on the same-size Android phone, and always has. That is a design
// decision to make deliberately (it means re-tuning every fixed card slot), not
// something to correct one line at a time.

type Face = 'serif' | 'serifItalic' | 'sans';

const X_HEIGHT: Record<Face, number> = Platform.select({
  ios: { serif: 0.4927, serifItalic: 0.4858, sans: 0.5078 },
  android: { serif: 0.536, serifItalic: 0.536, sans: 0.5283 },
  default: { serif: 0.4927, serifItalic: 0.4858, sans: 0.5078 },
}) as Record<Face, number>;

/**
 * The point size at which `face` draws lowercase letters as tall as `matching`
 * does at `size` — i.e. "make this line look the same size as the text it sits
 * next to", across two families and two platforms.
 *
 * For ELASTIC layouts only. Where a slot has a fixed height and a line clamp
 * (the card deck), correcting the size pushes text at the clip instead of
 * fixing it — there the rule is to pick a family whose x-height already matches,
 * which is what the ≤3% guard in fonts.test.ts enforces.
 *
 * Under RTL every constant above collapses to the one system face, so there are
 * no two families to reconcile and the size passes through untouched.
 */
export function opticalSize(size: number, face: Face, matching: Face): number {
  if (I18nManager.isRTL) return size;
  return Math.round(((size * X_HEIGHT[matching]) / X_HEIGHT[face]) * 100) / 100;
}

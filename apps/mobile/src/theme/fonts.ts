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

/** Monospace — the small gold "edge-code"/eyebrow labels. */
export const MONO_FAMILY: string | undefined = I18nManager.isRTL
  ? undefined
  : (Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }) as string);

/**
 * Font families — the app ships no custom fonts, so we map the prototype's
 * "Source Serif 4 / JetBrains Mono" intent onto the platform defaults the app
 * already uses (SetIntroScreen, etc. use Georgia for serif). Import these
 * instead of re-deriving the Platform.select in every component.
 */

import { Platform } from 'react-native';

/** Serif display — headlines, the placement word, big level labels. */
export const SERIF_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
}) as string;

/** Monospace — the small gold "edge-code"/eyebrow labels. */
export const MONO_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

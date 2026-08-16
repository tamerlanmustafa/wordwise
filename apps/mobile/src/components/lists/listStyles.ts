/**
 * Shared type scale + metrics for the Lists tab.
 *
 * The design splits type into two voices and never mixes them:
 *   • serif  — anything the user wrote or is reading (list names, film
 *              titles, words).
 *   • mono   — anything measured (counts, `5 FILMS · 20,424 WORDS`, CEFR
 *              pills). Always uppercase, 10.5px / 600 / +0.4 tracking.
 *
 * Kept here rather than duplicated across the index, the detail screen and
 * the sheets so the two voices can't drift apart.
 */

import { StyleSheet, type TextStyle } from 'react-native';
import { MONO_FAMILY, SERIF_FAMILY } from '../../theme/fonts';

/** Every metric label on the tab. Colour is applied by the caller. */
export const metaText: TextStyle = {
  fontFamily: MONO_FAMILY,
  fontSize: 10.5,
  fontWeight: '600',
  letterSpacing: 0.4,
};

export const listName: TextStyle = {
  fontFamily: SERIF_FAMILY,
  fontSize: 16.5,
  fontWeight: '700',
};

export const screenTitle: TextStyle = {
  fontFamily: SERIF_FAMILY,
  fontSize: 30,
  fontWeight: '700',
  letterSpacing: -0.9,
};

export const detailTitle: TextStyle = {
  fontFamily: SERIF_FAMILY,
  fontSize: 27,
  fontWeight: '700',
  letterSpacing: -0.8,
};

/** The first-three-words line under a word list's name. */
export const previewWords: TextStyle = {
  fontFamily: SERIF_FAMILY,
  fontSize: 13,
  fontStyle: 'italic',
};

export const METRICS = {
  rowRadius: 14,
  rowMinHeight: 68,
  rowGap: 10,
  rowInnerGap: 14,
  posterW: 46,
  posterH: 68,
  posterRadius: 3,
  /** How far each poster in the fan is offset from the one beneath it. */
  posterOffset: 13,
  fanBoxW: 72,
  wordTileW: 58,
  wordTileH: 68,
  wordTileRadius: 13,
  circleBtn: 34,
  segmentH: 38,
  segmentRadius: 12,
  segmentPad: 3,
  segmentThumbRadius: 9,
  chevron: 15,
  /** Toast sits clear of the tab bar. */
  toastBottom: 98,
} as const;

/** Uppercase for the mono voice. `toLocaleUpperCase` so Turkish dotted/
 *  dotless i and Russian casing come out right, not just ASCII. */
export function metaCase(value: string, language: string): string {
  return value.toLocaleUpperCase(language);
}

/** ` · ` — the separator between metric segments and preview words. */
export const META_SEPARATOR = ' · ';

export const sharedStyles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
});

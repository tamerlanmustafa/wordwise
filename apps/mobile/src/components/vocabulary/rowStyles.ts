import { Platform, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../theme/tokens';
import { alignEnd } from '../../i18n/rtl';

// Serif gives the vocabulary rows a calmer, book-page feel — Georgia is
// preinstalled on iOS; Android falls back to its default serif. Body text is
// upright; only the highlighted target word (in the sentence and, when open,
// the word-line translation) is italic.
export const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

// Themed row styles shared by the unified VocabRow (words + idioms, both the
// For You tab and the level tabs). Built per-render with useMemo(makeRowStyles,
// [tc]) — every colour comes from `tc.*` so the row is correct in light AND
// dark. Per-row accents that depend on the CEFR level colour (highlight,
// expansion rule, level washes) are applied inline by the component.
/** Spacing between the actions under an expanded row, both axes. */
export const ROW_ACTIONS_GAP = 16;

/**
 * Touch padding for a row's icon-only action (the speaker). Same defect and
 * same fix as the card deck's `FOOTER_ICON_HIT_SLOP`: a bare `Text onPress`
 * on a 14pt emoji, inside the row's own expand/collapse touchable, gives a
 * target barely larger than the glyph.
 *
 * Bounded on BOTH axes here, where the card's is bounded only horizontally:
 * `actionsRow` sets `flexWrap`, so when the actions spill onto a second line
 * the gap above and below is also `ROW_ACTIONS_GAP` — a taller slop would
 * overlap the wrapped neighbour and start eating its taps.
 */
export const ROW_ICON_HIT_SLOP = {
  top: ROW_ACTIONS_GAP / 2,
  bottom: ROW_ACTIONS_GAP / 2,
  left: ROW_ACTIONS_GAP / 2,
  right: ROW_ACTIONS_GAP / 2,
} as const;

export const makeRowStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tc.divider,
    },
    leftBar: {
      position: 'absolute',
      start: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: tc.gold,
    },
    rowNum: {
      width: 22,
      textAlign: alignEnd,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.4,
      color: tc.textFaint,
      fontVariant: ['tabular-nums'],
      paddingTop: 5,
      marginEnd: 12,
    },
    body: {
      flex: 1,
      minWidth: 0,
    },
    wordLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexWrap: 'wrap',
    },
    wordText: {
      fontFamily: SERIF,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: -0.2,
      color: tc.text,
    },
    wordTextRead: {
      color: tc.textSecondary,
    },
    translationDot: {
      fontFamily: SERIF,
      fontSize: 14,
      fontWeight: '500',
      fontStyle: 'normal',
      color: tc.textFaint,
    },
    translationText: {
      fontFamily: SERIF,
      fontSize: 14,
      fontWeight: '600',
      fontStyle: 'italic',
      color: tc.primaryOnSurface,
    },
    translationSkeleton: {
      width: 68,
      height: 11,
      borderRadius: 4,
      backgroundColor: tc.skeleton,
      alignSelf: 'center',
    },
    sentence: {
      fontFamily: SERIF,
      fontSize: 13.5,
      lineHeight: 20,
      color: tc.textSecondary,
      marginTop: 5,
    },
    sentenceHi: {
      fontFamily: SERIF,
      fontWeight: '700',
      fontStyle: 'italic',
    },
    // Always-visible sentence skeleton (word rows still loading their preview).
    sentenceSkeletonWrap: {
      marginTop: 5,
    },
    skelBar: {
      height: 12,
      borderRadius: 4,
      backgroundColor: tc.skeleton,
    },
    expansion: {
      marginTop: 9,
      borderStartWidth: 2,
      paddingStart: 11,
    },
    expandSkeletonGroup: {
      gap: 7,
      paddingVertical: 2,
    },
    sentenceTranslation: {
      fontFamily: SERIF,
      fontSize: 13,
      lineHeight: 19,
      fontStyle: 'italic',
      color: tc.textSecondary,
    },
    idiomSentence: {
      fontFamily: SERIF,
      fontSize: 13.5,
      lineHeight: 20,
      color: tc.textSecondary,
      marginBottom: 6,
    },
    noExamples: {
      fontFamily: SERIF,
      fontSize: 13,
      fontStyle: 'italic',
      color: tc.textFaint,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 16,
      marginTop: 7,
    },
    // The action labels used to carry their glyph inside the text run (⚐, 🚫)
    // so the icon sat on the text baseline and scaled with the font. They are
    // drawn icons in a row beside the label now.
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    actionText: {
      fontSize: 11,
      fontWeight: '600',
      color: tc.textFaint,
    },
    actionHide: {
      color: tc.error,
    },
    starBtn: {
      flexShrink: 0,
      width: 34,
      height: 34,
      marginTop: -7,
      marginEnd: -6,
      marginBottom: -7,
      marginStart: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    idiomBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      alignSelf: 'center',
    },
    idiomBadgeText: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
    // Premium cross-movie block — restyled to the same quiet ledger look.
    crossMovieSection: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tc.divider,
    },
    crossMovieLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: tc.textFaint,
      marginBottom: 4,
    },
    crossMovieItem: {
      marginBottom: 4,
    },
    crossMovieMovie: {
      fontSize: 12,
      fontWeight: '600',
      color: tc.primaryOnSurface,
    },
    crossMovieSentence: {
      fontFamily: SERIF,
      fontSize: 12,
      fontStyle: 'italic',
      color: tc.textSecondary,
    },
  });

export type RowStyles = ReturnType<typeof makeRowStyles>;

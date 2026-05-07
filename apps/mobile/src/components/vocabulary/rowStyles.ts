import { StyleSheet } from 'react-native';
import { colors } from '../../theme/palette';

// Shared row styles used by both WordRow and IdiomRow (vocabulary tab).
export const rowStyles = StyleSheet.create({
  wordRowWrapper: {
    marginBottom: -1,
  },
  wordRow: {
    backgroundColor: '#F0E8FA',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#DDD0EE',
  },
  wordRowExpanded: {
    borderColor: colors.primary,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  wordRowBookmarked: {
    borderColor: '#F4A261',
    backgroundColor: '#FFF7E6',
  },
  wordRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  rowNumber: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '600',
    minWidth: 28,
  },
  wordText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  inlineLevelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  inlineLevelBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  pronounceBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  pronounceIcon: {
    fontSize: 16,
  },
  pronounceIconActive: {
    opacity: 0.5,
  },
  inlineSpinner: {
    marginHorizontal: 8,
  },
  bookmarkButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  bookmarkIcon: {
    fontSize: 20,
    color: colors.border,
  },
  bookmarkIconActive: {
    color: '#F4A261',
  },
  dropdownPanel: {
    backgroundColor: colors.paper,
    borderLeftWidth: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  expandSkeletonGroup: {
    paddingVertical: 4,
    gap: 8,
  },
  expandSkeletonBar: {
    height: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(124, 92, 191, 0.16)',
  },
  expandSkeletonBarShort: { width: '55%' },
  expandSkeletonBarLong: { width: '92%' },
  expandSkeletonBarMid: { width: '75%' },
  translationBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  translationDash: {
    fontSize: 15,
    color: colors.textSecondary,
    marginRight: 6,
  },
  translationText: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  translationUntranslatable: {
    fontStyle: 'italic',
    color: colors.textSecondary,
  },
  noTranslation: {
    fontSize: 14,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  exampleCard: {
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
  },
  exampleSentence: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  exampleTranslation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  highlightedWord: {
    fontWeight: '700',
    color: colors.primary,
  },
  noExamples: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  crossMovieSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  crossMovieLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: 4,
  },
  crossMovieItem: {
    marginBottom: 4,
  },
  crossMovieMovie: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  crossMovieSentence: {
    fontSize: 12,
    color: colors.text,
    fontStyle: 'italic',
  },
  reportInlineBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  reportInlineBtnText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});

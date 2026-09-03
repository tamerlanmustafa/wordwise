/**
 * ComprehensionSheet — "what does 86% mean", opened by tapping a home card's
 * level ring.
 *
 * The ring shows one number and the meta line shows a CEFR band, and the two
 * are easy to conflate: one is about the *reader* (how much of this film's
 * vocabulary you should already know), the other is about the *film* (what its
 * whole vocabulary grades out at). They used to be the same number rendered
 * twice, which is exactly why they need saying apart, once, plainly.
 *
 * Built on the shared `BottomSheet` with the vocabulary `FeedFilterSheet`
 * established — grabber, 17/'800' title, gold Done, `bottomOffset` so no row
 * hides behind the floating bar.
 *
 * Rendered at the HomeScreen root rather than inside the card: BottomSheet is
 * an absolute overlay, so from inside a 116pt FlashList cell it would be
 * clipped to that cell — and the cell is recycled out from under it besides.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getFormattingLocale } from '../../i18n';
import { useThemeColors, withAlpha, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { CEFR_LEVELS } from '../../types/constants';
import { BottomSheet } from '../common/BottomSheet';
import type { KnownShare } from './comprehension';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — the sheet reserves it as inner padding. */
  bottomOffset?: number;
  title: string;
  /** Distinct classified words per band, straight off the movie payload. */
  dist: Record<string, number> | null | undefined;
  /** The reader's level — the cut point the gold half of the bar stops at. */
  level: string;
  share: KnownShare;
  /** The film's own CEFR band, from its whole vocabulary. Null if ungraded. */
  band: string | null;
}

export function ComprehensionSheet({
  visible,
  onClose,
  bottomOffset,
  title,
  dist,
  level,
  share,
  band,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const locale = getFormattingLocale();

  const cut = CEFR_LEVELS.indexOf(level as (typeof CEFR_LEVELS)[number]);

  // One pass over the six bands, so the bar and the legend can't disagree
  // about which side of the cut a band falls on.
  const segments = useMemo(
    () =>
      CEFR_LEVELS.map((code, i) => {
        const n = Number(dist?.[code]);
        return {
          code,
          count: Number.isFinite(n) && n > 0 ? n : 0,
          known: i <= cut,
          // Gold stepping down in alpha across the known half, so the bar
          // reads as one block that is *made of* bands rather than six
          // unrelated colours; everything above the cut is quiet ink.
          color: i <= cut
            ? withAlpha(tc.gold, 0.95 - i * 0.2)
            : withAlpha(tc.text, 0.16),
        };
      }).filter((seg) => seg.count > 0),
    [dist, cut, tc.gold, tc.text],
  );

  const num = (n: number) => n.toLocaleString(locale);

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <View style={s.pad}>
        <Text style={s.title}>{t('home:comprehension.title', { pct: share.pct })}</Text>
        <Text style={s.body}>
          {t('home:comprehension.body', {
            total: num(share.total),
            title,
            atOrBelow: num(share.atOrBelow),
            pct: share.pct,
            level,
          })}
        </Text>

        {/* One stacked bar rather than six meters: the question is what share
            of *one* vocabulary sits below the cut, and a stacked bar is the
            only form where that cut is a place you can point at. */}
        <View style={s.bar}>
          {segments.map((seg, i) => (
            <View
              key={seg.code}
              style={{
                flex: seg.count,
                backgroundColor: seg.color,
                // A hairline in the sheet's own paper, so the divider reads as
                // a gap rather than as a seventh colour. Between segments only
                // — on the first it would be a nick out of the bar's own edge.
                borderStartWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                borderStartColor: tc.paper,
              }}
            />
          ))}
        </View>

        <View style={s.legend}>
          {segments.map((seg) => (
            <View key={seg.code} style={s.legendItem}>
              <View style={[s.swatch, { backgroundColor: seg.color }]} />
              <Text style={[s.legendText, !seg.known && s.legendTextAbove]}>
                {`${seg.code} ${num(seg.count)}`}
              </Text>
            </View>
          ))}
        </View>

        {/* The pair the old ring conflated. Said once, side by side, with the
            value in a fixed leading column so the two read as one table. */}
        <View style={s.factRow}>
          <Text style={s.factValue}>{`${share.pct}%`}</Text>
          <Text style={s.factLabel}>{t('home:comprehension.factShare')}</Text>
        </View>
        {band ? (
          <View style={[s.factRow, s.factRowLast]}>
            <Text style={s.factValue}>{band}</Text>
            <Text style={s.factLabel}>{t('home:comprehension.factBand')}</Text>
          </View>
        ) : null}

        {/* Load-bearing, not a footnote. `cefr_distribution` counts distinct
            words (types), not spoken words (tokens), and the commonest words
            repeat all film — so a coverage claim without this line overstates
            how hard the film is to follow. */}
        <Text style={s.caveat}>
          {t('home:comprehension.caveat', { pct: share.pct })}
        </Text>

        <TouchableOpacity
          style={s.doneBtn}
          onPress={onClose}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={s.doneLabel}>{t('home:filters.done')}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    pad: {
      paddingHorizontal: 12,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      color: tc.text,
      letterSpacing: -0.2,
    },
    body: {
      fontSize: 13.5,
      lineHeight: 21,
      color: tc.textSecondary,
      marginTop: 8,
    },
    bar: {
      flexDirection: 'row',
      height: 16,
      borderRadius: 8,
      overflow: 'hidden',
      marginTop: 18,
      backgroundColor: tc.chipBg,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginTop: 10,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    swatch: {
      width: 7,
      height: 7,
      borderRadius: 2,
    },
    legendText: {
      fontFamily: MONO_FAMILY,
      fontSize: 10,
      fontWeight: '700',
      color: tc.goldOnSurface,
    },
    legendTextAbove: {
      color: tc.textFaint,
    },
    factRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tc.divider,
      marginTop: 4,
    },
    factRowLast: {
      marginTop: 0,
    },
    factValue: {
      width: 52,
      fontFamily: MONO_FAMILY,
      fontSize: 15,
      fontWeight: '700',
      color: tc.goldOnSurface,
    },
    factLabel: {
      flex: 1,
      minWidth: 0,
      fontSize: 12.5,
      lineHeight: 17,
      color: tc.textSecondary,
    },
    caveat: {
      fontSize: 11.5,
      lineHeight: 16,
      color: tc.textFaint,
      marginTop: 12,
    },
    doneBtn: {
      marginTop: 16,
      height: 48,
      borderRadius: 13,
      backgroundColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Gold-on-dark text is goldDeep, never white — white fails contrast.
    doneLabel: {
      fontSize: 15,
      fontWeight: '800',
      color: tc.goldDeep,
    },
  });

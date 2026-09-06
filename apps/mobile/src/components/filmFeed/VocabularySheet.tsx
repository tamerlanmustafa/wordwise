/**
 * VocabularySheet — "what's in this film", opened by tapping a home card's
 * vocabulary ring.
 *
 * The ring gives one number, the film's distinct-word count. This sheet gives
 * the thing a single number never can: the *shape* of that vocabulary, and
 * where the reader's own level falls inside it.
 *
 * The bar is the oldest surviving part of this screen and the only part that
 * never had to be rewritten, through four different ring metrics. That is not
 * a coincidence — it does not compress the film to one figure, so there was
 * never a figure to be wrong. Worth remembering the next time the temptation
 * is to replace it with a headline statistic.
 *
 * Built on the shared `BottomSheet` with the vocabulary `FeedFilterSheet`
 * established — grabber, 17/'800' title, gold Done, `bottomOffset` so no row
 * hides behind the floating bar.
 *
 * Rendered at the FilmFeedScreen root rather than inside the card: BottomSheet is
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
import type { FilmVocabulary } from './filmVocabulary';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — the sheet reserves it as inner padding. */
  bottomOffset?: number;
  title: string;
  /** Distinct classified words per band, straight off the movie payload. */
  dist: Record<string, number> | null | undefined;
  /** The reader's level — where the bar's gold half stops. */
  level: string;
  vocab: FilmVocabulary;
  /** The film's own CEFR band, from its whole vocabulary. Null if ungraded. */
  band: string | null;
}

export function VocabularySheet({
  visible,
  onClose,
  bottomOffset,
  title,
  dist,
  level,
  vocab,
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
          // Gold is the part of this film's vocabulary already within reach at
          // the reader's level. The ring no longer claims anything about the
          // reader, so this is the only place the two meet — and it is a
          // shape, not a headline figure, which is why it can say it honestly.
          known: i <= cut,
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
        <Text style={s.title}>{t('home:vocabSheet.title')}</Text>
        <Text style={s.body}>
          {t('home:vocabSheet.body', {
            total: num(vocab.words),
            title,
            level,
          })}
        </Text>

        {/* One stacked bar rather than six meters: the question is where the
            reader's level falls inside *one* vocabulary, and a stacked bar is
            the only form where that cut is a place you can point at. */}
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

        {/* Two facts about the film, said apart. They were once the same
            number rendered twice, which is why they are still listed
            separately even though nothing conflates them today. */}
        <View style={s.factRow}>
          <Text style={s.factValue}>{num(vocab.words)}</Text>
          <Text style={s.factLabel}>{t('home:vocabSheet.factWords')}</Text>
        </View>
        {band ? (
          <View style={[s.factRow, s.factRowLast]}>
            <Text style={s.factValue}>{band}</Text>
            <Text style={s.factLabel}>{t('home:vocabSheet.factBand')}</Text>
          </View>
        ) : null}

        {/* Load-bearing, not a footnote. `cefr_distribution` counts distinct
            words (types), not spoken words (tokens), so a word said once
            counts the same as one repeated through the whole film. Without
            this line the count reads as an amount of listening. */}
        <Text style={s.caveat}>{t('home:vocabSheet.caveat')}</Text>

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

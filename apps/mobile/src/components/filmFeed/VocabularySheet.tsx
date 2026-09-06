/**
 * VocabularySheet — "what's in this film", opened by tapping a home card's
 * vocabulary ring.
 *
 * The ring gives one number, the film's distinct-word count. This sheet gives
 * the thing a single number never can: the *shape* of that vocabulary.
 *
 * The bar is the oldest surviving part of this screen and the only part that
 * never had to be rewritten, through four different ring metrics. That is not
 * a coincidence — it does not compress the film to one figure, so there was
 * never a figure to be wrong. Worth remembering the next time the temptation
 * is to replace it with a headline statistic.
 *
 * ## Colour means difficulty
 *
 * Each band takes its colour from `theme/cefrRamp` — gold at A1 through to red
 * at C2 — and the legend prints in the same colours, so the bar and the list
 * underneath it are two readings of one array.
 *
 * It used to shade gold-if-at-or-below-your-level and grey above, which said
 * something about the reader rather than about the film. That cost the sheet
 * its self-containment: the same segment was gold on one account and grey on
 * another, so neither the bar nor the legend could be read without knowing who
 * was holding the phone. The reader's own level is no longer marked here at
 * all — it is on the filter button two taps away, and the sheet is now about
 * the film.
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
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrRampFor } from '../../theme/cefrRamp';
import { MONO_FAMILY } from '../../theme/fonts';
import { CEFR_LEVELS } from '../../types/constants';
import { BottomSheet } from '../common/BottomSheet';
import { withTap } from '../../utils/feedback';
import type { FilmVocabulary } from './filmVocabulary';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — the sheet reserves it as inner padding. */
  bottomOffset?: number;
  /** Distinct classified words per band, straight off the movie payload. */
  dist: Record<string, number> | null | undefined;
  vocab: FilmVocabulary;
  /** The film's own CEFR band, from its whole vocabulary. Null if ungraded. */
  band: string | null;
}

export function VocabularySheet({ visible, onClose, bottomOffset, dist, vocab, band }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const locale = getFormattingLocale();

  // One pass over the six bands, so the bar and the legend read exactly the
  // same colour for a band — they are two views of one array, not two
  // lookups that have to be kept in step.
  const segments = useMemo(() => {
    const ramp = cefrRampFor(tc);
    return CEFR_LEVELS.map((code, i) => {
      const n = Number(dist?.[code]);
      return {
        code,
        count: Number.isFinite(n) && n > 0 ? n : 0,
        color: ramp[i],
      };
    }).filter((seg) => seg.count > 0);
  }, [dist, tc]);

  const num = (n: number) => n.toLocaleString(locale);

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <View style={s.pad}>
        <Text style={s.title}>{t('home:vocabSheet.title')}</Text>

        {/* One stacked bar rather than six meters: the question is how *one*
            vocabulary is shared out across the bands, and a stacked bar is the
            only form where the proportions are the shape itself rather than
            six lengths to compare by eye. Segments are `flex: count`, so the
            widths are the counts. */}
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

        {/* The legend carries its colour in the type itself, so nothing is
            drawn in front of a label. A little coloured square there says the
            same thing the coloured text already says, and it was the wider of
            the two — six of them set the row's rhythm to the decoration
            rather than to the numbers. (A test in __tests__ enforces this by
            scanning for the name of that shape, so do not write it here.)

            Six pairs do not fit on one line, so this wraps — and a wrapping
            row of *views* is what keeps a code with its count. Nested Texts
            were tried and are not enough: inline text wraps at any space it
            finds, including the one between a code and its number, so "C1 56"
            broke across two lines with the count orphaned under it. A flex
            item is atomic, so the only place a break can land is between
            items.

            The separator belongs to the pair before it for the same reason —
            as its own item it could be the thing that wraps, leaving a line
            beginning with a bare pipe. */}
        <View style={s.legend}>
          {segments.map((seg, i) => (
            <View key={seg.code} style={s.legendItem}>
              <Text style={[s.legendText, { color: seg.color }]} numberOfLines={1}>
                {`${seg.code} ${num(seg.count)}`}
              </Text>
              {i < segments.length - 1 ? <Text style={s.legendSep}>|</Text> : null}
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

        {/* The types-vs-tokens caveat used to sit here — `cefr_distribution`
            counts distinct words, so a word said once counts the same as one
            repeated all film. It is still true, and it is still why
            `factWords` says "distinct" rather than "words"; that label is now
            the only place it is stated, so keep the word in it. */}

        <TouchableOpacity
          style={s.doneBtn}
          onPress={withTap(onClose)}
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
      alignItems: 'center',
      marginTop: 10,
      // Between items on a line, and between the lines themselves. The row gap
      // is the larger of the two: a wrapped second line otherwise sits so
      // close under the first that the six pairs read as one block.
      columnGap: 8,
      rowGap: 6,
    },
    // The pair and the pipe that follows it, as one unbreakable item.
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    legendText: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '700',
      // Colour comes from the ramp, per band — see cefrRamp.
    },
    // Faint on purpose: the pipe is punctuation between two readings, and at
    // the legend's own weight it competes with the counts either side of it.
    legendSep: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '700',
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

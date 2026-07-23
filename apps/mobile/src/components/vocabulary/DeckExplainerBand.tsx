import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Trans, useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { cefrColors, cefrLabelsFull } from '../../theme/palette';

/**
 * DeckExplainerBand — the fixed 104px band between the level filters and the
 * card deck (Ledger mockup 1a). Two variants that swap with the selected
 * filter, both exactly BAND_HEIGHT so the deck below never moves:
 *
 *  - "foryou": sells the ranked deck — eyebrow, mix tag, ranked-words line,
 *    and a subtitle-coverage meter (hidden when the metric is unavailable).
 *  - "level": quieter informational variant — level dot + eyebrow, count
 *    line, and the Rarest first / Most common sort pills.
 */

export const BAND_HEIGHT = 104;

export type BandSortOrder = 'rare' | 'common';

export type DeckExplainerBandProps =
  | {
      variant: 'foryou';
      /** Deck size — the bold "{N} words that matter most" count. */
      deckSize: number;
      /** e.g. "B1+B2 MIX" — the user's level ±1. */
      mixLabel: string;
      /** 0–100, or null to hide the meter row. */
      coveragePct: number | null;
    }
  | {
      variant: 'level';
      level: string;
      /** Full word (+ idiom) count at this level. */
      count: number;
      sortOrder: BandSortOrder;
      onSortChange: (order: BandSortOrder) => void;
    };

export const DeckExplainerBand = (props: DeckExplainerBandProps) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  if (props.variant === 'foryou') {
    const { deckSize, mixLabel, coveragePct } = props;
    return (
      <LinearGradient
        colors={[`${tc.gold}21`, `${tc.gold}0D`]}
        style={[s.band, s.bandForYou]}
      >
        <View style={s.eyebrowRow}>
          <Text style={s.sparkle}>✦</Text>
          <Text style={s.eyebrowGold}>{t('vocabulary:deckExplainer.eyebrowForYou')}</Text>
          <View style={s.flexSpacer} />
          <View style={s.mixTag}>
            <Text style={s.mixTagText}>{mixLabel}</Text>
          </View>
        </View>
        <View style={s.bodyRow}>
          <Text style={s.bodyText}>
            <Trans
              i18nKey="vocabulary:deckExplainer.bodyForYou"
              count={deckSize}
              components={[<Text key="b" style={s.bodyBold} />]}
            />
          </Text>
        </View>
        {coveragePct != null ? (
          <View style={s.meterRow}>
            <View style={s.meterTrack}>
              <LinearGradient
                colors={['#C58B1B', '#E0A62E']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[s.meterFill, { width: `${Math.min(100, Math.max(0, coveragePct))}%` }]}
              />
            </View>
            <Text style={s.meterLabel}>{t('vocabulary:deckExplainer.coverage', { percent: Math.round(coveragePct) })}</Text>
          </View>
        ) : null}
      </LinearGradient>
    );
  }

  const { level, count, sortOrder, onSortChange } = props;
  const levelColor = cefrColors[level] || tc.primary;
  const label = cefrLabelsFull[level] || level;
  return (
    <View style={[s.band, s.bandLevel]}>
      <View style={s.eyebrowRow}>
        <View style={[s.levelDot, { backgroundColor: levelColor }]} />
        <Text style={s.eyebrowQuiet}>
          {t('vocabulary:deckExplainer.eyebrowLevel', { level, label: label.toUpperCase() })}
        </Text>
      </View>
      <View style={s.bodyRow}>
        <Text style={s.bodyText}>
          <Trans
            i18nKey="vocabulary:deckExplainer.bodyLevel"
            count={count}
            values={{ level }}
            components={[<Text key="b" style={s.bodyBold} />]}
          />
        </Text>
      </View>
      <View style={s.sortRow}>
        {(
          [
            { key: 'rare' as const, label: t('vocabulary:deckExplainer.sortRarest') },
            { key: 'common' as const, label: t('vocabulary:deckExplainer.sortCommon') },
          ]
        ).map(({ key, label: pillLabel }) => {
          const selected = sortOrder === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => onSortChange(key)}
              activeOpacity={0.7}
              style={[s.sortPill, selected && s.sortPillSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[s.sortPillText, selected && s.sortPillTextSelected]}>{pillLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const makeStyles = (tc: ThemeColors, scheme: 'light' | 'dark') =>
  StyleSheet.create({
    band: {
      height: BAND_HEIGHT,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 11,
      paddingHorizontal: 13,
    },
    bandForYou: {
      borderColor: `${tc.gold}59`,
    },
    bandLevel: {
      borderColor: tc.border,
      backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.55)',
    },
    eyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    sparkle: {
      color: tc.gold,
      fontSize: 11,
    },
    eyebrowGold: {
      fontFamily: MONO_FAMILY,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: tc.goldOnSurface,
    },
    eyebrowQuiet: {
      fontFamily: MONO_FAMILY,
      fontSize: 9.5,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: tc.textSecondary,
    },
    levelDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    flexSpacer: {
      flex: 1,
    },
    mixTag: {
      backgroundColor: `${tc.gold}29`,
      borderWidth: 1,
      borderColor: `${tc.gold}59`,
      borderRadius: 5,
      paddingVertical: 2,
      paddingHorizontal: 6,
    },
    mixTagText: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.55,
      color: tc.goldOnSurface,
    },
    bodyRow: {
      flex: 1,
      justifyContent: 'center',
    },
    bodyText: {
      fontFamily: SERIF_FAMILY,
      fontSize: 13.5,
      lineHeight: 18,
      color: scheme === 'dark' ? tc.textSecondary : '#4A3D28',
    },
    bodyBold: {
      fontWeight: '700',
      color: scheme === 'dark' ? tc.text : '#2D2418',
    },
    meterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
    },
    meterTrack: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: scheme === 'dark' ? 'rgba(255,209,102,0.16)' : 'rgba(139,90,0,0.16)',
      overflow: 'hidden',
    },
    meterFill: {
      height: 4,
      borderRadius: 2,
    },
    meterLabel: {
      fontFamily: MONO_FAMILY,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.55,
      color: tc.goldOnSurface,
    },
    sortRow: {
      flexDirection: 'row',
      gap: 6,
    },
    sortPill: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: scheme === 'dark' ? tc.border : '#DCD2B8',
    },
    sortPillSelected: {
      backgroundColor: `${tc.primary}24`,
      borderColor: `${tc.primary}66`,
    },
    sortPillText: {
      fontSize: 10.5,
      fontWeight: '800',
      color: tc.textFaint,
    },
    sortPillTextSelected: {
      color: tc.primaryOnSurface,
    },
  });

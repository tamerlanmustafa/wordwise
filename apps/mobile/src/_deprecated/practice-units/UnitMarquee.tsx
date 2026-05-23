/**
 * UnitMarquee — v0.7 Practice tab "Now Showing" unit header.
 *
 * Sits above each unit's lesson path. 46×68 poster on the left, eyebrow
 * + serif title + CEFR badge + tagline in the middle, monospace
 * "done/total" chip on the right. A row of 10 marquee bulbs runs across
 * the top edge (alternating gold-glow / outline).
 *
 * Spec: `tabs/practice.jsx → UnitMarquee`.
 */

import { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { cefrColors } from '../../theme/palette';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { PracticeUnit } from '../../services/api';

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

export interface UnitMarqueeProps {
  unit: PracticeUnit;
  /** True for the first unit on the screen — tighter top margin since
   *  the section header sits directly above. Subsequent units get
   *  extra breathing room (32px) so they read as discrete chapters. */
  first?: boolean;
}

export function UnitMarquee({ unit, first }: UnitMarqueeProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const cefr = unit.cefr_level && unit.cefr_level in cefrColors
    ? cefrColors[unit.cefr_level]
    : tc.textFaint;

  const posterUri = unit.poster_path
    ? `https://image.tmdb.org/t/p/w185${unit.poster_path}`
    : null;

  return (
    <View style={[s.card, { marginTop: first ? 8 : 32 }]}>
      {/* Marquee bulbs across the top edge */}
      <View style={s.bulbs} pointerEvents="none">
        {Array.from({ length: 10 }).map((_, i) => {
          const lit = i % 2 === 0;
          return (
            <View
              key={i}
              style={[
                s.bulb,
                lit
                  ? {
                      backgroundColor: tc.gold,
                      shadowColor: tc.gold,
                      shadowOpacity: 0.85,
                      shadowRadius: 6,
                    }
                  : {
                      backgroundColor: 'transparent',
                      borderWidth: 1,
                      borderColor: tc.border,
                    },
              ]}
            />
          );
        })}
      </View>

      {/* Poster */}
      <View style={s.posterWrap}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={s.poster} resizeMode="cover" />
        ) : (
          <View style={[s.poster, { backgroundColor: tc.surface }]} />
        )}
      </View>

      {/* Meta */}
      <View style={s.metaCol}>
        <Text style={s.eyebrow}>UNIT · NOW SHOWING</Text>
        <Text style={s.title} numberOfLines={1}>
          {unit.title}
        </Text>
        <View style={s.subRow}>
          {unit.cefr_level ? (
            <View style={[s.cefrBadge, { backgroundColor: cefr }]}>
              <Text style={s.cefrText}>{unit.cefr_level}</Text>
            </View>
          ) : null}
          {unit.tagline ? (
            <Text style={s.tagline} numberOfLines={1}>
              {unit.tagline}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Progress badge */}
      <View style={s.progressChip}>
        <Text style={s.progressDone}>{unit.done}</Text>
        <Text style={s.progressTotal}>/{unit.total}</Text>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      position: 'relative',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    bulbs: {
      position: 'absolute',
      top: -4,
      left: 14,
      right: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    bulb: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      shadowOffset: { width: 0, height: 0 },
    },
    posterWrap: {
      width: 46,
      height: 68,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: tc.surface,
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    poster: { width: '100%', height: '100%' },
    metaCol: {
      flex: 1,
      minWidth: 0,
    },
    eyebrow: {
      fontSize: 9.5,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldOnSurface,
      marginBottom: 2,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 18,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.3,
      lineHeight: 20,
      marginBottom: 4,
    },
    subRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    cefrBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 3,
    },
    cefrText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '900',
      letterSpacing: 0.3,
    },
    tagline: {
      fontSize: 11,
      fontWeight: '700',
      color: tc.textFaint,
      flexShrink: 1,
    },
    progressChip: {
      flexDirection: 'row',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'baseline',
    },
    progressDone: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '900',
      color: tc.text,
    },
    progressTotal: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '900',
      color: tc.textFaint,
    },
  });

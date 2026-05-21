/**
 * DailyReviewHero — v0.7 Practice tab hero card.
 *
 * The single biggest call-to-action on the screen. Two states:
 *   • Not done today  → gold card with serif headline, perforation
 *                       strip on the left edge (the only filmic
 *                       flourish kept from the v0.6 reel direction),
 *                       "START SESSION →" pill CTA, side note.
 *   • Done today      → compact gold pill "Today's done · 🔥 N" (no
 *                       longer tappable — discoverable but quiet).
 *
 * Spec: `tabs/practice.jsx` daily-review-hero block.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

const SERIF_FAMILY = 'Source Serif 4';

export interface DailyReviewHeroProps {
  /** Number of cards in today's queue, for the headline. */
  cardsDue: number;
  /** Current streak, for the "done" pill + filling the side note. */
  streak: number;
  /** Whether the user has already completed today's session. */
  doneToday: boolean;
  onStartPress: () => void;
}

export function DailyReviewHero({
  cardsDue,
  streak,
  doneToday,
  onStartPress,
}: DailyReviewHeroProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  if (doneToday) {
    return (
      <View style={s.doneWrap}>
        <View style={s.donePill} pointerEvents="none">
          <Text style={s.doneText} numberOfLines={1}>
            Today's done
            {streak > 0 ? (
              <Text style={s.doneStreak}>  ·  🔥 {streak}</Text>
            ) : null}
          </Text>
        </View>
      </View>
    );
  }

  // ~2 min headline — math: ~12s/card median. Show the queue size and
  // let users self-anchor on the time estimate.
  const minutes = Math.max(1, Math.round((cardsDue * 12) / 60));

  return (
    <Pressable
      onPress={onStartPress}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }]}
    >
      {/* Film-perforation strip on the left edge — the v0.7 brand nod. */}
      <View style={s.perforationCol} pointerEvents="none">
        {Array.from({ length: 14 }).map((_, i) => (
          <View
            key={i}
            style={[
              s.perforationHole,
              i % 2 === 0
                ? { backgroundColor: tc.goldDeep, opacity: 0.25 }
                : { backgroundColor: 'transparent' },
            ]}
          />
        ))}
      </View>

      <View style={s.body}>
        <Text style={s.eyebrow}>TODAY'S REVIEW</Text>
        <Text style={s.headline} numberOfLines={1}>
          {cardsDue} word{cardsDue === 1 ? '' : 's'} · ~{minutes} min
        </Text>
        <View style={s.ctaRow}>
          <View style={s.cta}>
            <Text style={s.ctaText}>START SESSION →</Text>
          </View>
          <Text style={s.sideNote} numberOfLines={1}>
            +25 XP · keeps streak
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    card: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 16,
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderRadius: 16,
      backgroundColor: tc.gold,
      position: 'relative',
      overflow: 'hidden',
      shadowColor: tc.gold,
      shadowOpacity: 0.35,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    perforationCol: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: 8,
      flexDirection: 'column',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    perforationHole: {
      width: 8,
      height: 6,
    },
    body: {
      paddingLeft: 8,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldDeep,
      opacity: 0.7,
      textTransform: 'uppercase',
    },
    headline: {
      fontFamily: SERIF_FAMILY,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: -0.4,
      color: tc.goldDeep,
      marginTop: 4,
      lineHeight: 28,
    },
    ctaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 10,
    },
    cta: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: tc.goldDeep,
    },
    ctaText: {
      color: tc.gold,
      fontSize: 12,
      fontWeight: '900',
      letterSpacing: 0.6,
    },
    sideNote: {
      flex: 1,
      fontSize: 10,
      fontWeight: '800',
      color: tc.goldDeep,
      opacity: 0.7,
      letterSpacing: 0.4,
    },

    // Done-today compact pill
    doneWrap: {
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 16,
      alignItems: 'flex-start',
    },
    donePill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: tc.gold,
      shadowColor: tc.gold,
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    doneText: {
      fontSize: 12,
      fontWeight: '800',
      color: tc.goldDeep,
      letterSpacing: 0.2,
    },
    doneStreak: {
      fontWeight: '900',
      color: tc.goldDeep,
    },
  });

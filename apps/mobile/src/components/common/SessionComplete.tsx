/**
 * SessionComplete — the shared "you finished, here's your progress" reward
 * (Motion §E4 / UX audit F-016). One component so the daily review and the
 * movie/journey quiz tell the same story in the same visual language, instead
 * of two divergent completion screens.
 *
 * Renders the content BELOW a host's header (the host owns SafeAreaView + any
 * back chrome): a success ring, mono eyebrow, serif title, an optional
 * comprehension-delta card, a count-up stat grid, an optional slot for
 * per-surface extras (pips / word recap / wall copy), and a primary (+ optional
 * secondary) CTA. Confetti + count-ups honor reduce-motion via their primitives.
 */

import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { PressableScale } from '../ui/PressableScale';
import { Confetti } from '../ui/Confetti';
import { CountUp } from '../ui/CountUp';
import { FORWARD_ARROW } from '../../i18n/rtl';

export interface SessionStat {
  value: number;
  label: string;
  suffix?: string;
  /** Emphasize with the gold-on-surface accent (e.g. the headline number). */
  accent?: boolean;
}

export interface SessionCompleteProps {
  eyebrow: string;
  title: string;
  stats: SessionStat[];
  /** Frequency-weighted comprehension delta — the single most motivating number. */
  comprehension?: { before: number; after: number } | null;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Confetti burst on mount (gate on a genuinely positive result). */
  celebrate?: boolean;
  /** Per-surface extras rendered between the stat grid and the CTA. */
  children?: ReactNode;
}

export function SessionComplete({
  eyebrow,
  title,
  stats,
  comprehension,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  celebrate,
  children,
}: SessionCompleteProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const compDelta = comprehension ? Math.round(comprehension.after - comprehension.before) : 0;

  return (
    <View style={s.root}>
      {celebrate ? <Confetti /> : null}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.ring}>
          <Ionicons name="checkmark" size={34} color={tc.success} />
        </View>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.title}>{title}</Text>

        {comprehension ? (
          <View style={s.compCard}>
            <Text style={s.compEyebrow}>COMPREHENSION</Text>
            <View style={s.compRow}>
              <Text style={s.compBefore}>{Math.round(comprehension.before)}%</Text>
              <Text style={s.compArrow}>{FORWARD_ARROW}</Text>
              <CountUp style={s.compAfter} value={Math.round(comprehension.after)} suffix="%" duration={1100} delay={650} />
              {compDelta !== 0 ? (
                <Text style={[s.compDelta, compDelta > 0 ? s.compDeltaUp : s.compDeltaDown]}>
                  {compDelta > 0 ? `+${compDelta}` : `${compDelta}`}%
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {stats.length > 0 ? (
          <View style={s.statGrid}>
            {stats.map((st, i) => (
              <View key={`${st.label}-${i}`} style={s.stat}>
                <CountUp
                  style={[s.statValue, st.accent && s.statValueAccent]}
                  value={st.value}
                  suffix={st.suffix}
                  duration={900}
                  delay={300 + i * 120}
                />
                <Text style={s.statLabel}>{st.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {children}
      </ScrollView>

      <View style={s.footer}>
        <PressableScale style={s.primaryBtn} onPress={onPrimary} accessibilityRole="button" accessibilityLabel={primaryLabel}>
          <Text style={s.primaryBtnText}>{primaryLabel}</Text>
        </PressableScale>
        {secondaryLabel && onSecondary ? (
          <PressableScale style={s.secondaryBtn} onPress={onSecondary} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
            <Text style={s.secondaryBtnText}>{secondaryLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1 },
    scroll: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
    ring: {
      width: 78,
      height: 78,
      borderRadius: 39,
      borderWidth: 2,
      borderColor: tc.success,
      backgroundColor: tc.successTint,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    eyebrow: {
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: -0.4,
      color: tc.text,
      textAlign: 'center',
      marginTop: 8,
    },
    // Comprehension delta card (mirrors QuizResultScreen's compCard, themed).
    compCard: {
      width: '100%',
      marginTop: 20,
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
    },
    compEyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    compRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    compBefore: { fontSize: 18, fontWeight: '700', color: tc.textFaint },
    compArrow: { fontSize: 18, fontWeight: '700', color: tc.textFaint },
    compAfter: { fontSize: 32, fontWeight: '900', color: tc.text, letterSpacing: -0.6 },
    compDelta: {
      marginStart: 6,
      fontSize: 13,
      fontWeight: '900',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      overflow: 'hidden',
    },
    compDeltaUp: { color: tc.goldDeep, backgroundColor: tc.gold },
    compDeltaDown: { color: '#fff', backgroundColor: tc.error },
    // Stat grid
    statGrid: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 20 },
    stat: { alignItems: 'center' },
    statValue: { fontSize: 24, fontWeight: '800', color: tc.text },
    statValueAccent: { color: tc.goldOnSurface },
    statLabel: { fontSize: 12, color: tc.textSecondary, marginTop: 2 },
    // Footer
    footer: { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 8, gap: 10 },
    primaryBtn: { backgroundColor: tc.gold, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
    primaryBtnText: { color: tc.goldDeep, fontSize: 15, fontWeight: '900', letterSpacing: 0.3 },
    secondaryBtn: { alignItems: 'center', paddingVertical: 6 },
    secondaryBtnText: { color: tc.textSecondary, fontSize: 13, fontWeight: '700' },
  });

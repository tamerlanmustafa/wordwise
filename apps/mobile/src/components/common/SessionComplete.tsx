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

import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { Confetti } from '../ui/Confetti';
import { CountUp } from '../ui/CountUp';
import { FORWARD_ARROW } from '../../i18n/rtl';

/** Depth of the edge under the primary CTA. Matches the quiz card's
 *  CTA_EDGE, so the whole quiz surface shares one physical language. */
const CTA_EDGE = 4;

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
  /** The round's per-question outcomes, repeated here as a scorecard row —
   *  the same segments the quiz header showed while you were answering, so
   *  the summary is recognisably the bar you just filled. */
  outcomes?: readonly boolean[];
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
  outcomes,
}: SessionCompleteProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // Both hosts render under the global tab bar, which is an absolute overlay
  // — without this the Done button sits behind it.
  const barInset = useBottomBarInset();
  // Same press as the quiz card's Next: only the face sinks onto the edge.
  const ctaPress = useRef(new Animated.Value(0)).current;

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

        {outcomes && outcomes.length > 0 ? (
          <View style={s.scorecard}>
            {outcomes.map((ok, i) => (
              <View
                key={i}
                style={[
                  s.scoreSegment,
                  { backgroundColor: ok ? tc.success : tc.error },
                ]}
              />
            ))}
          </View>
        ) : null}

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

      {/* `barInset` covers the floating iOS glass capsule, which hovers clear
          of the screen edge — a footer padded only by the safe area sits
          underneath it. */}
      <View style={[s.footer, { paddingBottom: barInset + 10 }]}>
        {/* The same construction the quiz card's Next wears: a paper face
            with a rim, and a full-height edge copy sunk CTA_EDGE beneath it.
            The palette is the card's answered-correct one — this screen is
            the quiz's correct ending, and its lip was already quizCorrectEdge. */}
        <Pressable
          onPress={onPrimary}
          onPressIn={() => ctaPress.setValue(1)}
          onPressOut={() => ctaPress.setValue(0)}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
        >
          <View style={s.primarySlot}>
            <View style={[s.primaryEdge, { backgroundColor: tc.quizCorrectEdge }]} />
            <Animated.View
              style={[
                s.primaryBtn,
                { transform: [{ translateY: ctaPress.interpolate({ inputRange: [0, 1], outputRange: [0, CTA_EDGE - 1] }) }] },
              ]}
            >
              <Text style={s.primaryBtnText}>{primaryLabel}</Text>
            </Animated.View>
          </View>
        </Pressable>
        {secondaryLabel && onSecondary ? (
          <Pressable style={s.secondaryBtn} onPress={onSecondary} accessibilityRole="button" accessibilityLabel={secondaryLabel}>
            <Text style={s.secondaryBtnText}>{secondaryLabel}</Text>
          </Pressable>
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
    // The round's outcome, repeated as the same segments the header carried.
    scorecard: {
      flexDirection: 'row',
      gap: 5,
      marginTop: 16,
      alignSelf: 'stretch',
      paddingHorizontal: 8,
    },
    scoreSegment: {
      flex: 1,
      height: 6,
      borderRadius: 999,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 32,
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
    // Footer. `paddingBottom` is applied inline from `useBottomBarInset`.
    footer: { paddingHorizontal: 24, paddingTop: 8, gap: 12 },
    // Reserves the edge's depth, so pressing the button does not shift the bar.
    primarySlot: { paddingBottom: CTA_EDGE },
    // A full-height copy of the face offset CTA_EDGE down, like the answer
    // tiles and the quiz card's CTA — not a 5px strip, whose radius would eat
    // the whole shape and read as a hairline rather than thickness.
    primaryEdge: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: CTA_EDGE,
      bottom: 0,
      borderRadius: 16,
    },
    primaryBtn: {
      height: 54,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: tc.success,
      backgroundColor: tc.paper,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: {
      fontFamily: MONO_FAMILY,
      color: tc.success,
      fontSize: 13.5,
      fontWeight: '900',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    secondaryBtn: { alignItems: 'center', paddingVertical: 6 },
    secondaryBtnText: { color: tc.textSecondary, fontSize: 13, fontWeight: '700' },
  });

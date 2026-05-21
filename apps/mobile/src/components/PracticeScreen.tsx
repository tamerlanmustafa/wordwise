/**
 * PracticeScreen — v0.7 "Practice" tab.
 *
 * The Duolingo-style learning path. Daily SRS hero up top (the streak
 * anchor), then a vertical scroll of per-movie "units" with 5 lesson
 * nodes each.
 *
 * Data:
 *   • daily SRS state ← `dailyGoalStore` (local) + the existing
 *     `srsApi.startSession` flow when the user taps START.
 *   • streak counter ← `dailyGoalStore.streak`.
 *   • units ← `practiceApi.listUnits()`.
 *
 * Spec: `tabs/practice.jsx → PracticeScreen` (all visual values 1:1).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useDailyGoalStore, DAILY_GOAL } from '../stores/dailyGoalStore';
import { practiceApi, type PracticeLesson, type PracticeUnit } from '../services/api';
import { DailyReviewHero } from './practice/DailyReviewHero';
import { UnitMarquee } from './practice/UnitMarquee';
import { UnitPath } from './practice/UnitPath';

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

export interface PracticeScreenProps {
  /** Opens the existing ReviewScreen (App.tsx navigateToReview). */
  onStartDailyReview: () => void;
  /** Optional: deep-link a tap on a lesson node into the per-movie quiz
   *  flow. For v0.7 we just open the unit's movie quiz; SetIntro then
   *  QuizLessonScreen handle the rest. */
  onLessonPress?: (unit: PracticeUnit, lesson: PracticeLesson) => void;
}

export function PracticeScreen({ onStartDailyReview, onLessonPress }: PracticeScreenProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Daily-habit state. The store hydrates itself on first mount via the
  // existing DAILY_GOAL pipeline; we just read.
  const dailyDone = useDailyGoalStore((st) => st.done);
  const dailyStreak = useDailyGoalStore((st) => st.streak);
  const dailyHydrated = useDailyGoalStore((st) => st.hydrated);
  const hydrateDaily = useDailyGoalStore((st) => st.hydrate);
  useEffect(() => {
    if (!dailyHydrated) void hydrateDaily();
  }, [dailyHydrated, hydrateDaily]);

  const doneToday = dailyDone >= DAILY_GOAL;

  // Units — one network call on mount. No pagination for v0.7; the
  // endpoint caps at 50 server-side.
  const [units, setUnits] = useState<PracticeUnit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    practiceApi
      .listUnits(20)
      .then((res) => {
        if (cancelled) return;
        setUnits(res.units);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[PracticeScreen] listUnits failed:', e?.message);
        setError(e?.message || 'Failed to load practice path');
        setUnits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Warm vertical glow at the top — RN's expo-linear-gradient
          doesn't do radial, so we use a vertical gold-to-transparent
          fade. Visually close to the radial in `tabs/practice.jsx`
          on phone-sized canvases where the radial's curvature is
          imperceptible anyway. */}
      <LinearGradient
        colors={[tc.heroGlowStart, 'transparent']}
        locations={[0, 1]}
        style={s.glow}
        pointerEvents="none"
      />

      {/* Header row */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>DAILY PRACTICE</Text>
          <Text style={s.title}>Practice</Text>
        </View>
        <View style={s.streakChip}>
          <Text style={s.streakFire}>🔥</Text>
          <Text style={s.streakNumber}>{dailyStreak}</Text>
          <Text style={s.streakLabel}>{dailyStreak === 1 ? 'DAY' : 'DAYS'}</Text>
        </View>
      </View>

      {/* Scrolling content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollPad}
        showsVerticalScrollIndicator={false}
      >
        <DailyReviewHero
          cardsDue={12}
          streak={dailyStreak}
          doneToday={doneToday}
          onStartPress={onStartDailyReview}
        />

        {/* 3 mini stats. v0.7 placeholders — wired to dailyGoalStore +
            simple counts. Real XP/words/in-progress values can flow
            in once UserQuizStats is exposed on the practice payload. */}
        <View style={s.statRow}>
          <MiniStat icon="⭐" n="—"            l="XP today" tc={tc} s={s} />
          <MiniStat icon="📚" n={`${dailyStreak}`} l="streak" tc={tc} s={s} />
          <MiniStat icon="🎬" n={`${units?.length ?? 0}`} l="in progress" tc={tc} s={s} />
        </View>

        {/* Section header */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>YOUR STUDY PATH</Text>
          {/* "See all" reserved for the (future) full path screen.
              For v0.7 we render every unit returned so the link
              would be a no-op — leaving the affordance off rather
              than wiring an inert tap target. */}
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="small" color={tc.gold} />
          </View>
        ) : units && units.length > 0 ? (
          units.map((unit, i) => (
            <View key={unit.unit_id}>
              <UnitMarquee unit={unit} first={i === 0} />
              <UnitPath unit={unit} onLessonPress={onLessonPress} />
              {i < units.length - 1 ? <Intermission tc={tc} /> : null}
            </View>
          ))
        ) : (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>No units yet</Text>
            <Text style={s.emptyBody}>
              {error
                ? "We couldn't load your practice path — try again in a moment."
                : 'Add a movie to your library and your study path will appear here.'}
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MiniStat({
  icon,
  n,
  l,
  tc,
  s,
}: {
  icon: string;
  n: string;
  l: string;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
}) {
  // tc kept on the API for symmetry with other helpers; styling lives
  // in the parent's StyleSheet so tokens cascade without per-call
  // useThemeColors() invocations.
  void tc;
  return (
    <View style={s.statCard}>
      <Text style={s.statIcon}>{icon}</Text>
      <View>
        <Text style={s.statNumber}>{n}</Text>
        <Text style={s.statLabel}>{l}</Text>
      </View>
    </View>
  );
}

function Intermission({ tc }: { tc: ThemeColors }) {
  return (
    <View style={styles.intermissionRow}>
      <View style={[styles.intermissionRule, { backgroundColor: tc.divider }]} />
      <Text style={[styles.intermissionText, { color: tc.textFaint }]}>
        INTERMISSION
      </Text>
      <View style={[styles.intermissionRule, { backgroundColor: tc.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  intermissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  intermissionRule: {
    flex: 1,
    height: 1,
  },
  intermissionText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
});

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: tc.background,
    },
    glow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 280,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 6,
      paddingBottom: 6,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    title: {
      fontFamily: SERIF_FAMILY,
      fontSize: 30,
      fontWeight: '600',
      letterSpacing: -0.8,
      color: tc.text,
      lineHeight: 32,
    },
    streakChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    streakFire: { fontSize: 16 },
    streakNumber: {
      fontFamily: MONO_FAMILY,
      fontSize: 14,
      fontWeight: '900',
      color: tc.text,
    },
    streakLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: tc.textFaint,
      letterSpacing: 0.6,
    },
    scrollPad: {
      paddingBottom: 24,
    },
    statRow: {
      flexDirection: 'row',
      gap: 8,
      marginHorizontal: 16,
      marginBottom: 18,
    },
    statCard: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    statIcon: { fontSize: 18 },
    statNumber: {
      fontFamily: MONO_FAMILY,
      fontSize: 14,
      fontWeight: '900',
      color: tc.text,
      lineHeight: 14,
    },
    statLabel: {
      fontSize: 9,
      color: tc.textFaint,
      letterSpacing: 0.8,
      fontWeight: '800',
      marginTop: 2,
      textTransform: 'uppercase',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 22,
      paddingBottom: 4,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.textFaint,
      textTransform: 'uppercase',
    },
    loadingWrap: {
      paddingVertical: 40,
      alignItems: 'center',
    },
    emptyState: {
      paddingHorizontal: 28,
      paddingTop: 32,
      paddingBottom: 16,
      gap: 8,
    },
    emptyTitle: {
      fontFamily: SERIF_FAMILY,
      fontSize: 20,
      fontWeight: '700',
      color: tc.text,
      letterSpacing: -0.3,
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 19,
      color: tc.textSecondary,
    },
  });

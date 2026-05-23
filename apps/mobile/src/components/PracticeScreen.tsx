/**
 * PracticeScreen — v0.7.2 "Practice" tab.
 *
 * Daily-habit dashboard with a path of practice-tile circles. The user
 * picks ONE tile per UTC day; that pick stamps `srsLastSessionKind` on
 * the User row and runs the kind-specific SRS queue composer. Mercy
 * infrastructure (auto-grant + auto-consume freezes) already protects
 * the streak across missed days — see `services/streak_service.py`.
 *
 * Sections, top → bottom:
 *   1. Header (eyebrow + serif title + streak chip)
 *   2. Mini stats row
 *   3. DailyReviewHero (still the headline "today's task" affordance)
 *   4. Vertical tile path — bottom-anchored so today's pickable tile
 *      is in the user's eye when the tab opens
 *
 * The hero card and the bottom tile mean the same thing (start today's
 * session) — different surfaces for different intents. Tapping either
 * route into ReviewScreen with the chosen kind.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useDailyGoalStore, DAILY_GOAL } from '../stores/dailyGoalStore';
import { useReelStore } from '../stores/reelStore';
import {
  dailyApi,
  srsApi,
  SrsPaywallError,
  type DailyState,
  type SessionKind,
  KIND_UNLOCK_THRESHOLDS,
} from '../services/api';
import { DailyReviewHero } from './practice/DailyReviewHero';
import { PracticeTilePath } from './practice/PracticeTilePath';
import {
  MoviePickerModal,
  type DeepDiveMovieOption,
} from './practice/MoviePickerModal';

const SERIF_FAMILY = 'Source Serif 4';
const MONO_FAMILY = 'JetBrains Mono';

export interface PracticeScreenProps {
  /** Open the ReviewScreen with a specific session kind. Falls back to
   *  quick_recall when called with no args (kept for backward compat
   *  with the journey/legacy paths). */
  onStartDailyReview: (kind?: SessionKind, movieId?: number) => void;
  /** Surfaced when the SRS endpoint returns 402 "daily_cap_reached" —
   *  same handler the journey flow uses. */
  onPaywall?: (previewsUsed: number, previewsLimit: number) => void;
}

export function PracticeScreen({
  onStartDailyReview,
  onPaywall,
}: PracticeScreenProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Local mirror of the streak / done state — reads optimistic, then
  // gets corrected once /daily/state resolves.
  const dailyDone = useDailyGoalStore((st) => st.done);
  const dailyStreak = useDailyGoalStore((st) => st.streak);
  const dailyHydrated = useDailyGoalStore((st) => st.hydrated);
  const hydrateDaily = useDailyGoalStore((st) => st.hydrate);
  useEffect(() => {
    if (!dailyHydrated) void hydrateDaily();
  }, [dailyHydrated, hydrateDaily]);

  // Authoritative server state — gives us `last_session_kind` so we
  // can render the right tile as "done today".
  const [serverState, setServerState] = useState<DailyState | null>(null);
  const refreshServerState = useCallback(async () => {
    try {
      const next = await dailyApi.state();
      setServerState(next);
    } catch (e) {
      console.warn('[PracticeScreen] daily/state failed:', (e as Error)?.message);
    }
  }, []);
  useEffect(() => {
    void refreshServerState();
  }, [refreshServerState]);

  // Reel tiles for the Movie Deep-Dive picker. Cheap re-use — the reel
  // store is already hydrated by My Movies / Home elsewhere.
  const reelTiles = useReelStore((st) => st.tiles);
  const hydrateReel = useReelStore((st) => st.hydrate);
  const reelHydrated = useReelStore((st) => st.hydrated);
  useEffect(() => {
    if (!reelHydrated) void hydrateReel();
  }, [reelHydrated, hydrateReel]);

  // Effective streak / done — prefer server when present, fall back to
  // the local optimistic counter for the brief gap before the network
  // resolves on cold start.
  const effectiveStreak = serverState?.streak ?? dailyStreak;
  const doneToday = (serverState?.today_done ?? dailyDone >= DAILY_GOAL);
  const lastKind: SessionKind | null = serverState?.last_session_kind ?? null;

  // ── Movie picker modal state ────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const deepDiveOptions = useMemo<DeepDiveMovieOption[]>(
    () =>
      reelTiles
        .filter(
          (t) =>
            typeof t.movie_id === 'number' &&
            (t.comprehensibility_percent ?? 0) > 0,
        )
        .map((t) => ({
          movieId: t.movie_id!,
          title: t.title,
          posterPath: t.poster_path,
          comprehensibilityPercent: t.comprehensibility_percent ?? 0,
          cefrLevel: t.cefr_level ?? null,
        })),
    [reelTiles],
  );

  // ── Session-start handlers ──────────────────────────────────────
  const startKind = useCallback(
    (kind: SessionKind, movieId?: number) => {
      // We don't pre-check the daily cap client-side; the server's
      // 402 response is the authority. The paywall handler routes the
      // user to upgrade copy. For a kind that's locked by streak we
      // already filter the tap server-side; surface a soft toast if
      // the user somehow taps a locked tile (e.g. server <-> client
      // streak drift).
      if (kind !== 'quick_recall' && effectiveStreak < KIND_UNLOCK_THRESHOLDS[kind]) {
        Alert.alert(
          'Locked',
          `Keep your streak going to ${KIND_UNLOCK_THRESHOLDS[kind]} days to unlock this tile.`,
        );
        return;
      }
      onStartDailyReview(kind, movieId);
    },
    [effectiveStreak, onStartDailyReview],
  );

  const handleHeroPress = useCallback(() => {
    // Hero always starts Quick Recall — the no-decision default.
    startKind('quick_recall');
  }, [startKind]);

  const handleTilePress = useCallback(
    (kind: SessionKind) => {
      if (kind === 'movie_deep_dive') {
        if (deepDiveOptions.length === 0) {
          Alert.alert(
            'No movies ready',
            'Finish a Quick Recall or two so the Deep-Dive pool has words to pull from.',
          );
          return;
        }
        setPickerOpen(true);
        return;
      }
      startKind(kind);
    },
    [deepDiveOptions.length, startKind],
  );

  const handleMoviePicked = useCallback(
    (movieId: number) => {
      setPickerOpen(false);
      startKind('movie_deep_dive', movieId);
    },
    [startKind],
  );

  // ── Stat figures ────────────────────────────────────────────────
  const cardsDue = 12; // TODO: wire to srsApi.stats().due_today when surfaced

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <LinearGradient
        colors={[tc.heroGlowStart, 'transparent']}
        locations={[0, 1]}
        style={s.glow}
        pointerEvents="none"
      />

      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>DAILY PRACTICE</Text>
          <Text style={s.title}>Practice</Text>
        </View>
        <View style={s.streakChip}>
          <Text style={s.streakFire}>🔥</Text>
          <Text style={s.streakNumber}>{effectiveStreak}</Text>
          <Text style={s.streakLabel}>{effectiveStreak === 1 ? 'DAY' : 'DAYS'}</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.scrollPad}
        showsVerticalScrollIndicator={false}
      >
        <DailyReviewHero
          cardsDue={cardsDue}
          streak={effectiveStreak}
          doneToday={doneToday}
          onStartPress={handleHeroPress}
        />

        <View style={s.statRow}>
          <MiniStat icon="⭐" n="—" l="XP today" s={s} />
          <MiniStat icon="📚" n={`${effectiveStreak}`} l="streak" s={s} />
          <MiniStat
            icon="🛡️"
            n={`${serverState?.freezes_held ?? 0}`}
            l="freezes"
            s={s}
          />
        </View>

        {/* The tile chain. Bottom-to-top — visible bottom tile is the
            most accessible. The path itself doesn't know about the
            paywall / daily cap; the parent's `handleTilePress` does. */}
        <View style={s.pathWrap}>
          <Text style={s.pathHeading}>YOUR PRACTICE PATH</Text>
          <PracticeTilePath
            streak={effectiveStreak}
            lastSessionKind={lastKind}
            onTilePress={handleTilePress}
          />
        </View>
      </ScrollView>

      <MoviePickerModal
        visible={pickerOpen}
        options={deepDiveOptions}
        onPick={handleMoviePicked}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

function MiniStat({
  icon,
  n,
  l,
  s,
}: {
  icon: string;
  n: string;
  l: string;
  s: ReturnType<typeof makeStyles>;
}) {
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
      paddingBottom: 64,
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
    pathWrap: {
      paddingHorizontal: 18,
      paddingTop: 8,
    },
    pathHeading: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.textFaint,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginBottom: 4,
    },
  });

// Re-export to silence "exported but never imported" warnings when
// callers want a stronger handle on the paywall flow downstream.
export { SrsPaywallError } from '../services/api';
void srsApi; // referenced indirectly via dailyApi/srsApi import chain

/**
 * PracticeScreen — the "Practice" tab (Duolingo-style endless path).
 *
 * The tab is a linear chain of practice-tile circles. A single
 * client-side cursor (see `practicePathStore`) points at the next active
 * tile; tapping it starts a session and the cursor advances on
 * completion. Every tile is the same lesson: the server composes one
 * deck mixing due recalls, the user's own saved words, and fresh words
 * at their CEFR level. The path used to rotate three kinds, one of which
 * opened a poster picker and drew its cards from a single film's script
 * — so what you were quizzed on depended on your reel rather than your
 * level. Mercy infrastructure (auto-grant + auto-consume freezes)
 * continues to protect the daily streak across missed days — see
 * `services/streak_service.py`.
 *
 * Sections, top → bottom:
 *   1. Header (freeze + streak chips, the streak's flame animated)
 *   2. Vertical tile path — window of WINDOW_SIZE tiles around cursor
 *
 * Tapping the active path tile starts a session. Free users still hit
 * the daily cap on the second attempt — the server returns 402 and we
 * route through `onPaywall`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useAuthStore } from '../stores/authStore';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { usePracticePathStore } from '../stores/practicePathStore';
import {
  dailyApi,
  srsApi,
  type DailyState,
} from '../services/api';
import { PracticeBackdrop } from './practice/PracticeBackdrop';
import { PracticeTilePath } from './practice/PracticeTilePath';
import { StreakFlame } from './ui/StreakFlame';

const MONO_FAMILY = 'JetBrains Mono';

export interface PracticeScreenProps {
  /** Open the ReviewScreen on a new practice session. */
  onStartDailyReview: () => void;
  /** True while this tab is the visible one. The screen is kept mounted
   *  across tab switches (KeepAlive), so we re-fetch the daily server
   *  state each time it becomes visible again — e.g. after finishing a
   *  review — instead of relying on a one-time mount fetch. Defaults to
   *  true so standalone usage keeps working. */
  active?: boolean;
  /** Height the floating bottom bar reserves, so the tile path can scroll
   *  clear of it instead of ending underneath the glass. */
  bottomOffset?: number;
}

export function PracticeScreen({
  onStartDailyReview,
  active = true,
  bottomOffset = 0,
}: PracticeScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Local mirror of the streak — reads optimistic, then gets corrected
  // once /daily/state resolves.
  const dailyStreak = useDailyGoalStore((st) => st.streak);
  const dailyHydrated = useDailyGoalStore((st) => st.hydrated);
  const hydrateDaily = useDailyGoalStore((st) => st.hydrate);
  useEffect(() => {
    if (!dailyHydrated) void hydrateDaily();
  }, [dailyHydrated, hydrateDaily]);

  // Practice-path cursor — drives which tile is active. Keyed on the account:
  // the lesson number lives on the user now, not on the phone, so signing in
  // as someone else has to re-read it rather than keep the number on screen.
  // `hydrate` is a no-op when it has already run for this account.
  const cursor = usePracticePathStore((st) => st.cursor);
  const hydratePath = usePracticePathStore((st) => st.hydrate);
  const userId = useAuthStore((st) => st.user?.id ?? null);
  useEffect(() => {
    void hydratePath();
  }, [userId, hydratePath]);

  // Authoritative server state — streak + freezes for the header chip.
  const [serverState, setServerState] = useState<DailyState | null>(null);
  const refreshServerState = useCallback(async () => {
    // The lesson number is account state now, exactly like the streak beside
    // it, so it rides the same refresh: a phone that was behind catches up
    // when the tab is opened rather than only on the next cold start.
    void usePracticePathStore.getState().resync();
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

  // Re-fetch when the tab is re-shown (KeepAlive keeps us mounted, so the
  // mount effect above only fires once). Skip the initial mount — a ref
  // tracks the previous visibility so we only refresh on a hidden→visible
  // transition, e.g. returning here after completing a review.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refreshServerState();
    wasActive.current = active;
  }, [active, refreshServerState]);

  // Effective streak — prefer server when present, fall back to the
  // local optimistic counter for the brief gap before the network
  // resolves on cold start.
  const effectiveStreak = serverState?.streak ?? dailyStreak;

  // ── Session-start handler ───────────────────────────────────────
  // The daily cap is server-side: free users get one session/day, the
  // server returns 402 and we route through `onPaywall`. Progression is
  // purely sequential, so any tap that reaches here is on the active tile.
  const handleTilePress = useCallback(() => {
    onStartDailyReview();
  }, [onStartDailyReview]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <LinearGradient
        colors={[tc.heroGlowStart, 'transparent']}
        locations={[0, 1]}
        style={s.glow}
        pointerEvents="none"
      />
      <PracticeBackdrop />

      <View style={s.header}>
        <View style={s.headerChips}>
          <View style={s.streakChip}>
            <Ionicons name="shield-checkmark" size={15} color={tc.goldOnSurface} style={s.streakIcon} />
            <Text style={s.streakNumber}>{serverState?.freezes_held ?? 0}</Text>
            <Text style={s.streakLabel}>
              {t('practice:freeze', { count: serverState?.freezes_held ?? 0 })}
            </Text>
          </View>
          <View style={s.streakChip}>
            <StreakFlame size={20} lit={effectiveStreak > 0} style={s.streakIcon} />
            <Text style={s.streakNumber}>{effectiveStreak}</Text>
            <Text style={s.streakLabel}>{t('practice:dayLabel', { count: effectiveStreak })}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scrollPad, { paddingBottom: bottomOffset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The tile chain. The active tile is at the cursor; the rest
            are completed (past) or locked (future). The path itself
            doesn't know about the paywall / daily cap; the parent's
            `handleTilePress` does. */}
        <View style={s.pathWrap}>
          {/* No heading and no lesson number. The path is the only thing on
              the tab, so a label saying so was telling the user where they
              already were, and the lesson count was a number with nothing to
              compare it against — the coins themselves say how far along the
              road you are. */}
          <PracticeTilePath
            cursor={cursor}
            onTilePress={handleTilePress}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
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
    // Chips only. The screen used to open with a "DAILY PRACTICE" eyebrow over
    // a serif "Practice" title, which named the tab the user had just tapped
    // and cost ~60pt of the path's vertical room to do it.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 4,
    },
    headerChips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
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
    streakIcon: { marginEnd: 3 },
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
      // paddingBottom is applied inline from `bottomOffset` — the floating
      // bar's height isn't known until it reports it.
      paddingBottom: 0,
    },
    pathWrap: {
      paddingHorizontal: 18,
      paddingTop: 8,
    },
  });

// Re-export to silence "exported but never imported" warnings when
// callers want a stronger handle on the paywall flow downstream.
export { SrsPaywallError } from '../services/api';
void srsApi; // referenced indirectly via dailyApi/srsApi import chain

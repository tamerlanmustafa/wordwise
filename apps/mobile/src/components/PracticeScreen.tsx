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

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { TopInsetView } from './common/TopInsetView';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { useAuthStore } from '../stores/authStore';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { usePracticePathStore } from '../stores/practicePathStore';
import { showToast } from '../stores/toastStore';
import {
  dailyApi,
  srsApi,
  type DailyState,
} from '../services/api';
import { PracticeBackdrop } from './practice/PracticeBackdrop';
import { PracticeTilePath } from './practice/PracticeTilePath';
import { StreakWeek, WEEK_PANEL_H } from './practice/StreakWeek';

// The header's height, stated rather than derived — see StreakWeek's note on
// why. Its only child is the week panel, so the header is that panel's height
// plus the breathing room under it.
const HEADER_H = WEEK_PANEL_H + 8;

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

function PracticeScreenInner({
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
  const pathHydrated = usePracticePathStore((st) => st.hydrated);
  const hydratePath = usePracticePathStore((st) => st.hydrate);

  // Parks the path at its bottom once per cursor — see the ScrollView below.
  const scrollRef = useRef<ScrollView>(null);
  const didAnchor = useRef(false);
  useEffect(() => {
    didAnchor.current = false;
  }, [cursor]);
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
      // Say it out loud when a freeze was spent.
      //
      // `auto_consumed` has been on this response since the feature shipped
      // and NOTHING has ever read it — the backend's own comment says the
      // client should toast it. So a freeze was taken to cover a missed day
      // and the only evidence was the counter quietly being one lower than
      // the user remembered. That silence is half of why the mechanic felt
      // like something the app did *to* them; arming it is the other half.
      if (next.auto_consumed > 0) {
        showToast({
          message: t('practice:freezeUsed', { count: next.auto_consumed }),
          tone: 'success',
        });
      }
    } catch (e) {
      console.warn('[PracticeScreen] daily/state failed:', (e as Error)?.message);
    }
  }, [t]);
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

  // The panel takes both: the server's streak when it has answered, and the
  // local optimistic one for the moment before it does. Merging them here as
  // well would be a second copy of that rule.

  // ── Session-start handler ───────────────────────────────────────
  // The daily cap is server-side: free users get one session/day, the
  // server returns 402 and we route through `onPaywall`. Progression is
  // purely sequential, so any tap that reaches here is on the active tile.
  const handleTilePress = useCallback(() => {
    onStartDailyReview();
  }, [onStartDailyReview]);

  return (
    <TopInsetView style={s.root}>
      <LinearGradient
        colors={[tc.heroGlowStart, 'transparent']}
        locations={[0, 1]}
        style={s.glow}
        pointerEvents="none"
      />
      <PracticeBackdrop />

      <View style={s.header}>
        <StreakWeek state={serverState} fallbackStreak={dailyStreak} />
      </View>

      {/* Opens at the BOTTOM, not the top. The path climbs the screen, so the
          bottom is where the user is — the active tile sits four completed
          tiles up from the end and the rest of the content is road ahead to
          climb into. Anchored on content size rather than on mount, because
          the tiles lay out a frame after the cursor arrives and scrolling
          before that lands on the wrong offset.

          Re-armed whenever the cursor moves (see `didAnchor`), so finishing a
          session re-settles the active tile in its slot instead of leaving the
          user looking at whatever scroll position they had before. Guarded so
          it fires ONCE per cursor: running on every content-size change would
          yank the view back down while the user is scrolling. */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[s.scrollPad, { paddingBottom: bottomOffset + 24 }]}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (!pathHydrated || didAnchor.current) return;
          didAnchor.current = true;
          scrollRef.current?.scrollToEnd({ animated: false });
        }}
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
              road you are.

              Held until the cursor is known. The store starts at 0, so the
              first paint used to be lesson 1's window — a different set of
              tiles, with the section dividers falling in different rows —
              and it re-laid-out the moment the real cursor arrived a few
              milliseconds later. That jump read as the header shoving the
              tiles down. The wait is an AsyncStorage read, not a request. */}
          {pathHydrated ? (
            <PracticeTilePath
              cursor={cursor}
              onTilePress={handleTilePress}
            />
          ) : null}
        </View>
      </ScrollView>
    </TopInsetView>
  );
}

/** Memoized: kept mounted by App's `KeepAlive`, so without it every
 *  `setCurrentScreen` in the app re-rendered the whole path. */
export const PracticeScreen = memo(PracticeScreenInner);

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
      // Fixed, not content-sized. Everything in it arrives from the network —
      // the streak, the freeze counts, the seven day states — and anything
      // above the path that changes height after first paint moves every tile
      // below it. The numbers are free to change; the box they sit in is not.
      height: HEADER_H,
      justifyContent: 'center',
      // No horizontal padding and no row layout: the panel is one full-width
      // block that owns its own margins. `flex-end` here was the old two-chip
      // layout, and it left the panel pinned to the right of the screen.
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

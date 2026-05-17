/**
 * JourneyScreen — Journey Reel zigzag built from the user's combined
 * tile list (user picks DESC + suggested zone). The reel is always
 * populated — when the user has no picks, the suggested zone runs the
 * show. Tile 0 is bottom-most; tile (idx)'s state derives from
 * completedCount + VISIBLE_AHEAD per the spec.
 *
 * Visual layers, bottom → top (z-order inside the scroll content):
 *   1. JourneyReelBackground (fixed substrate: stock, leaks, grain,
 *      gutters, scratches).
 *   2. ScrollView content:
 *        a. JourneyReelSprockets (perforations + edge codes).
 *        b. Splice-tape detail (only at the user/suggested seam).
 *        c. JourneyConnector (path lines between tiles).
 *        d. MovieTiles.
 *        e. Zone-boundary chips (YOUR PICKS / SUGGESTED) — pointerEvents
 *           none, opaque backdrops so they stay legible over posters.
 *        f. ＋ Add a film tile at the bottom of the user zone (or the
 *           bottom of the reel if the user has added nothing).
 *   3. Top fade (viewport-anchored, color-matched to the stock).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
// NOTE: expo-blur's BlurView is intentionally NOT used here. It was
// installed but requires a native rebuild; on an existing dev binary
// it renders as <UnimplementedView> which prints the literal text
// "Unimplemented" mid-tree and (on some RN versions) breaks sibling
// rendering further down the list — which is why suggested tiles were
// vanishing. The opaque backdrop colors on the chips already satisfy
// the spec's legibility requirement ("Android falls back to translucent
// — acceptable"). Re-enable BlurView only after `expo prebuild` /
// `pod install` runs.
import { useAuthStore } from '../stores/authStore';
import { useReelStore } from '../stores/reelStore';
import { useDailyGoalStore, DAILY_GOAL } from '../stores/dailyGoalStore';
import { type NodeLevel } from './journey/JourneyNode';
import { type BottomTab } from './GlobalBottomBar';
import { JourneyReelBackground } from './journey/JourneyReelBackground';
import { JourneyReelSprockets } from './journey/JourneyReelSprockets';
import { MovieTile, type TileState } from './journey/MovieTile';
import { JourneyConnector } from './journey/JourneyConnector';
import { quizApi, type QuizStartSessionResponse } from '../services/api';

export interface SetIntroPayload {
  session: QuizStartSessionResponse;
  level: NodeLevel;
  tileIndex: number;
  movie: { title: string; poster_path: string | null };
  setNumber: number;
  reelNumber: number;
}

export interface JourneyScreenProps {
  onTabPress: (tab: BottomTab) => void;
  /** Tile tap → start a journey session for the active tile and surface
      the Set Intro preview. The user taps "Start learning" there to enter
      the quiz proper. */
  onShowSetIntro: (payload: SetIntroPayload) => void;
  /** How many tiles the user has completed so far. Persisted in App.tsx
      so returning from the quiz doesn't reset progress. */
  completedCount: number;
  /** Open the "Add Movies" picker (search in addToReel mode). Fired by
      the inline ＋ tile at the bottom of the user zone. */
  onAddMovies: () => void;
}

const WINDOW_WIDTH  = Dimensions.get('window').width;
const WINDOW_HEIGHT = Dimensions.get('window').height;

const VISIBLE_AHEAD      = 3;   // reduced from 9 to discourage grinding
const TILES_PER_DIAGONAL = 2;
const STEP_X             = 56;
const STEP_Y             = 62;
// Per spec: rTileY(idx) = PATH_HEIGHT - 38 - 28 - 80 - idx * STEP_Y.
// The 80px is reserved headroom that keeps the ＋ tile inside the
// path-area's overflow:hidden clip box. Do not remove.
const BOTTOM_PAD         = 38 + 28 + 80;
const TOP_PAD            = 60;
const CENTER_X           = WINDOW_WIDTH / 2;
const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const ACTIVE_TILE_SIZE = 92;
const PLUS_TILE_SIZE   = 60;

const CEFR_COLOR: Record<NodeLevel, string> = {
  A1: '#4CAF50',
  A2: '#8BC34A',
  B1: '#FFC107',
  B2: '#FF9800',
  C1: '#F44336',
  C2: '#9C27B0',
};

export function JourneyScreen({
  onTabPress: _onTabPress,
  onShowSetIntro,
  completedCount,
  onAddMovies,
}: JourneyScreenProps) {
  const user = useAuthStore((s) => s.user);
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);
  const insets = useSafeAreaInsets();

  // ─── Reel: combined user picks + suggested ──────────────────────────
  const reelTiles = useReelStore((s) => s.tiles);
  const userPickCount = useReelStore((s) => s.userPickCount);
  const reelHydrated = useReelStore((s) => s.hydrated);
  const hydrateReel = useReelStore((s) => s.hydrate);

  const dailyDone = useDailyGoalStore((s) => s.done);
  const dailyStreak = useDailyGoalStore((s) => s.streak);
  const dailyClamped = Math.min(dailyDone, DAILY_GOAL);
  useEffect(() => {
    if (!reelHydrated) hydrateReel();
  }, [reelHydrated, hydrateReel]);

  const TOTAL_TILES = reelTiles.length;

  const scrollY   = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const startScrollRef = useRef(0);

  // ─── Layout ──────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    const offsetFor = (i: number) => {
      const cycle = 2 * TILES_PER_DIAGONAL;
      const p     = i % cycle;
      return (p <= TILES_PER_DIAGONAL ? p : cycle - p) * STEP_X;
    };

    const naturalHeight = BOTTOM_PAD + TOTAL_TILES * STEP_Y + ACTIVE_TILE_SIZE + TOP_PAD;
    const totalHeight   = Math.max(WINDOW_HEIGHT + 200, naturalHeight);

    // rTileY mirrors the spec: tile center Y from the top of the scroll
    // content, with the spec's 38 + 28 + 80 px offset baked in via
    // BOTTOM_PAD.
    const rTileY = (i: number) => totalHeight - BOTTOM_PAD - i * STEP_Y;

    // Suggested tiles keep climbing through CEFR levels above the user's;
    // we walk LEVELS once and assign each suggested slot a level so the
    // colors stripe naturally bottom → top.
    const userIdx       = Math.max(0, LEVELS.indexOf(userLevel));
    const visibleLevels = LEVELS.slice(userIdx);
    const tilesPerLevel = Math.max(
      1,
      Math.ceil(Math.max(1, TOTAL_TILES) / visibleLevels.length),
    );
    const levelFor = (i: number): NodeLevel => {
      const li = Math.min(visibleLevels.length - 1, Math.floor(i / tilesPerLevel));
      return visibleLevels[li];
    };

    const tiles = reelTiles.map((m, i) => ({
      id: `t-${m.source}-${m.tmdb_id}`,
      idx: i,
      tmdbId: m.tmdb_id,
      x: CENTER_X - STEP_X + offsetFor(i),
      y: rTileY(i),
      level: levelFor(i),
      label: i + 1,
      poster: m.poster_path ?? null,
      title: m.title,
      source: m.source,
    }));

    return { tiles, totalHeight, rTileY };
  }, [userLevel, reelTiles, TOTAL_TILES]);

  // ─── Per-tile state derivation ──────────────────────────────────────
  const tileState = useCallback(
    (i: number): TileState => {
      if (i < completedCount)                  return 'completed';
      if (i === completedCount)                return 'active';
      if (i <= completedCount + VISIBLE_AHEAD) return 'inactive';
      return 'locked';
    },
    [completedCount],
  );

  // ─── Initial scroll offset — computed synchronously ─────────────────
  // Reserved viewport-bottom space for the GlobalBottomBar + a little
  // breathing room above it. Hardcoded because the bar's onLayout
  // height only arrives after first paint; using contentOffset
  // synchronously requires this known up-front. ~100 covers notched
  // iPhone safe area + 56pt bar with a small gap above.
  const NAV_BUFFER = 100;
  // The scrollable area extends NAV_BUFFER pixels past the bottom-most
  // tile so the ＋ tile and tile 1 sit just above the bottom nav.
  const scrollableHeight = layout.totalHeight + NAV_BUFFER;
  // Default = scrolled all the way down so the user lands on
  // ＋ → tile 1 → tile 2 → tile 3 → tile 4 from screen bottom up.
  const initialScrollOffset = Math.max(0, scrollableHeight - WINDOW_HEIGHT);
  startScrollRef.current = initialScrollOffset;

  // ─── First-launch tooltip for the ＋ Add a film tile ────────────────
  // Auto-dismisses after 5s OR on first tap of ＋. AsyncStorage flag
  // ensures it only shows once per device.
  const [plusTooltipVisible, setPlusTooltipVisible] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('journey.plusTooltipSeen').then((seen) => {
      if (!seen) {
        setPlusTooltipVisible(true);
        const t = setTimeout(() => {
          setPlusTooltipVisible(false);
          AsyncStorage.setItem('journey.plusTooltipSeen', '1').catch(() => {});
        }, 5000);
        return () => clearTimeout(t);
      }
    }).catch(() => {});
  }, []);
  const dismissPlusTooltip = useCallback(() => {
    if (plusTooltipVisible) {
      setPlusTooltipVisible(false);
      AsyncStorage.setItem('journey.plusTooltipSeen', '1').catch(() => {});
    }
  }, [plusTooltipVisible]);

  // ─── Tile press ──────────────────────────────────────────────────────
  const [startingTile, setStartingTile] = useState<number | null>(null);

  const handleTilePress = useCallback(async (i: number) => {
    if (i !== completedCount || startingTile !== null) return;
    const tile = layout.tiles[i];
    if (!tile) return;
    setStartingTile(i);
    try {
      const session = await quizApi.startJourneySession(tile.level, i, 5, tile.tmdbId);
      onShowSetIntro({
        session,
        level: tile.level,
        tileIndex: i,
        movie: { title: tile.title, poster_path: tile.poster },
        setNumber: tile.label,
        reelNumber: 1,
      });
    } catch (err: any) {
      Alert.alert('Could not start set', err?.message ?? 'Please try again.');
    } finally {
      setStartingTile(null);
    }
  }, [completedCount, layout.tiles, startingTile, onShowSetIntro]);

  // ─── Boundary positions for chips and the ＋ tile ───────────────────
  // When the user has no picks, the ＋ tile lives at the very bottom of
  // the reel (below idx 0 of the suggested zone) and the YOUR PICKS chip
  // is suppressed. Otherwise both chips bracket the user/suggested seam.
  const hasUserPicks   = userPickCount > 0;
  const topUserIdx     = userPickCount - 1;            // highest-idx user tile
  const yAboveUserTop  = hasUserPicks ? layout.rTileY(topUserIdx) - 28 : 0;
  const yBelowSuggBot  = hasUserPicks ? layout.rTileY(topUserIdx) + 70 : 0;
  // The ＋ tile lives at the bottom of the user zone — i.e., just below
  // the bottom-most tile of the reel, regardless of whether that tile
  // is a user pick or (when the reel is all-suggested) a suggested one.
  const plusTileTop    = layout.rTileY(0) + 80;

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <JourneyReelBackground></JourneyReelBackground>
      <Animated.ScrollView
        ref={scrollRef as any}
        style={{ flex: 1 }}
        contentContainerStyle={{ height: scrollableHeight }}
        contentOffset={{ x: 0, y: initialScrollOffset }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        <JourneyReelSprockets
          width={WINDOW_WIDTH}
          height={layout.totalHeight}
        ></JourneyReelSprockets>

        {/* ── In-path scroll-revealed film details (z BEHIND tiles) ── */}
        <FilmDetails
          rTileY={layout.rTileY}
          userPickCount={userPickCount}
          totalTiles={TOTAL_TILES}
        ></FilmDetails>

        <JourneyConnector
          width={WINDOW_WIDTH}
          height={layout.totalHeight}
          points={layout.tiles.map((t) => ({ idx: t.idx, x: t.x, y: t.y, source: t.source }))}
          completedCount={completedCount}
        ></JourneyConnector>

        {/* Movie tiles */}
        {layout.tiles.map((t, i) => {
          const state: TileState = startingTile === i ? 'active' : tileState(i);
          return (
            <MovieTile
              key={t.id}
              idx={t.idx}
              label={t.label}
              level={t.level}
              movie={t.title}
              poster={t.poster}
              state={state}
              centerX={t.x}
              centerY={t.y}
              source={t.source}
              onPress={() => handleTilePress(i)}
            ></MovieTile>
          );
        })}

        {/* Zone-boundary chips. Rendered ABOVE the tile layer so they
            sit on top of any poster they overlap, with opaque backdrops
            for legibility (see spec — do not soften). */}
        {hasUserPicks ? (
          <View
            pointerEvents="none"
            style={[
              styles.chipBase,
              styles.chipSuggested,
              {
                top: yAboveUserTop,
                left: 4,
                borderColor: CEFR_COLOR[userLevel],
              },
            ]}
          >
            <Text style={[styles.chipGlyph, { color: CEFR_COLOR[userLevel] }]}>▲</Text>
            <Text
              style={[
                styles.chipLabel,
                { color: CEFR_COLOR[userLevel], marginLeft: 6 },
              ]}
            >
              SUGGESTED
            </Text>
            <Text style={[styles.chipMeta, { marginLeft: 6 }]}>
              {userLevel} ±1
            </Text>
          </View>
        ) : null}

        {hasUserPicks ? (
          <View
            pointerEvents="none"
            style={[
              styles.chipBase,
              styles.chipUserPicks,
              {
                top: yBelowSuggBot,
                right: 4,
              },
            ]}
          >
            <Text style={[styles.chipGlyph, { color: '#FFD166' }]}>★</Text>
            <Text style={[styles.chipLabel, { color: '#FFD166', marginLeft: 6 }]}>
              YOUR PICKS
            </Text>
            <Text style={[styles.chipMeta, { marginLeft: 6 }]}>
              {userPickCount} added
            </Text>
          </View>
        ) : null}

        {/* ＋ Add a film tile — always tappable, regardless of state. */}
        <View
          style={{
            position: 'absolute',
            left: (WINDOW_WIDTH - PLUS_TILE_SIZE) / 2,
            top: plusTileTop,
            width: PLUS_TILE_SIZE,
            height: PLUS_TILE_SIZE,
          }}
        >
          <Pressable
            onPress={() => { dismissPlusTooltip(); onAddMovies(); }}
            style={styles.plusTile}
            accessibilityRole="button"
            accessibilityLabel="Add a film"
          >
            <Text style={styles.plusGlyph}>＋</Text>
            <Text style={styles.plusLabel} numberOfLines={1}>Add a film</Text>
          </Pressable>
          {plusTooltipVisible ? (
            <View pointerEvents="none" style={styles.plusTooltip}>
              <Text style={styles.plusTooltipText}>Tap to add your own film</Text>
              <View style={styles.plusTooltipCaret}></View>
            </View>
          ) : null}
        </View>
      </Animated.ScrollView>

      {/* Top fade — viewport-anchored, color-matched to the film stock. */}
      <LinearGradient
        colors={['rgba(26,17,9,1)', 'rgba(26,17,9,0.5)', 'rgba(26,17,9,0)']}
        locations={[0, 0.6, 1]}
        style={[styles.topFadeMask, { height: 160 + insets.top }]}
        pointerEvents="none"
      ></LinearGradient>

      {/* Daily-goal strip — viewport-anchored, sits ON TOP of the top
          fade so the pips remain legible even as locked tiles scroll
          beneath. The 3-set goal anchors the daily-habit loop. */}
      <View style={[styles.goalStrip, { top: insets.top + 8 }]} pointerEvents="none">
        <View style={styles.goalPips}>
          {Array.from({ length: DAILY_GOAL }).map((_, i) => (
            <View
              key={`pip-${i}`}
              style={[
                styles.goalPip,
                i < dailyClamped ? styles.goalPipFilled : styles.goalPipEmpty,
              ]}
            ></View>
          ))}
        </View>
        <Text style={styles.goalText} numberOfLines={1}>
          <Text style={styles.goalTextStrong}>{dailyClamped} of {DAILY_GOAL}</Text>
          <Text> · ~2 min each · </Text>
          <Text style={styles.goalTextStrong}>🔥 {dailyStreak}</Text>
        </Text>
      </View>

    </SafeAreaView>
  );
}

// ─── Film details ────────────────────────────────────────────────────
// SPLICE TAPE ONLY. The four other in-path details (frame edge codes,
// reel-end stencil, burn glow, clap-slate stencil) were cut after the
// cleanup audit — they stole attention from the active tile. The
// splice tape stays because it communicates structure ("two reels
// joined here") rather than being decoration.
function FilmDetails({
  rTileY,
  userPickCount,
  totalTiles,
}: {
  rTileY: (i: number) => number;
  userPickCount: number;
  totalTiles: number;
}) {
  const hasSeam = userPickCount > 0 && userPickCount < totalTiles;
  if (!hasSeam) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: 'absolute',
          left: -8,
          right: -8,
          top: rTileY(userPickCount) + 78,
          height: 12,
          transform: [{ rotate: '-0.4deg' }],
          borderTopWidth: 0.5,
          borderBottomWidth: 0.5,
          borderTopColor: 'rgba(140,80,30,0.4)',
          borderBottomColor: 'rgba(140,80,30,0.4)',
          borderStyle: 'dashed',
          opacity: 0.85,
        }}
      >
        <LinearGradient
          colors={[
            'rgba(238,200,140,0)',
            'rgba(238,200,140,0.22)',
            'rgba(238,200,140,0.18)',
            'rgba(238,200,140,0)',
          ]}
          locations={[0, 0.3, 0.7, 1]}
          style={StyleSheet.absoluteFill}
        ></LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#2E3B2C' },

  topFadeMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },

  // ── Zone-boundary chips ───────────────────────────────────────────
  chipBase: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  chipSuggested: {
    backgroundColor: 'rgba(26,17,9,0.88)',
    borderWidth: 1.5,
  },
  chipUserPicks: {
    backgroundColor: 'rgba(46,30,5,0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,209,102,0.7)',
  },
  chipGlyph: {
    fontSize: 11,
  },
  chipLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
  },
  chipMeta: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.4,
  },

  // ── ＋ Add a film tile ────────────────────────────────────────────
  plusTile: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    borderWidth: 2,
    // Neutral white — must NOT use gold or it competes with the active
    // tile's gold halo and reads as "today's set."
    borderColor: 'rgba(255,255,255,0.3)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusGlyph: {
    fontSize: 24,
    fontWeight: '300',
    color: 'rgba(255,255,255,0.75)',
    lineHeight: 24,
  },
  plusLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  plusTooltip: {
    position: 'absolute',
    top: -42,
    left: -50,
    width: 160,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: 'rgba(26,17,9,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  plusTooltipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },
  goalStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  goalPips: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  goalPip: {
    width: 24,
    height: 6,
    borderRadius: 3,
  },
  goalPipFilled: {
    backgroundColor: '#FFD166',
  },
  goalPipEmpty: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  goalText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
  },
  goalTextStrong: {
    color: '#FFD166',
    fontWeight: '800',
  },
  plusTooltipCaret: {
    position: 'absolute',
    bottom: -6,
    left: '50%',
    marginLeft: -6,
    width: 0, height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(26,17,9,0.96)',
  },
});

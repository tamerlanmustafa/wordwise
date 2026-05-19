/**
 * JourneyScreen — the Journey Reel. A zigzag stack of the user's
 * personal movie queue. Every tile is evergreen and tappable; the
 * tap opens the MoviePreviewHub for that movie. The reel is purely
 * user-curated — new users are auto-seeded a starter set by
 * `reelStore.hydrate()` on first launch.
 *
 * Visual layers, bottom → top (z-order inside the scroll content):
 *   1. JourneyReelBackground (fixed substrate: stock, leaks, grain,
 *      gutters, scratches).
 *   2. ScrollView content:
 *        a. JourneyReelSprockets (perforations + edge codes).
 *        b. JourneyConnector (path lines between tiles).
 *        c. MovieTiles (always evergreen, always tappable).
 *   3. Top fade (viewport-anchored, color-matched to the stock).
 *   4. Daily-goal strip — activity-based, anchored at top.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../stores/authStore';
import { useReelStore } from '../stores/reelStore';
import { useDailyGoalStore, DAILY_GOAL } from '../stores/dailyGoalStore';
import { type NodeLevel } from './journey/JourneyNode';
import { type BottomTab } from './GlobalBottomBar';
import { JourneyReelBackground } from './journey/JourneyReelBackground';
import { JourneyReelSprockets } from './journey/JourneyReelSprockets';
import { MovieTile } from './journey/MovieTile';
import { JourneyConnector } from './journey/JourneyConnector';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import type { ReelTile } from '../services/api';

export interface MoviePreviewPayload {
  tileIndex: number;
  level: NodeLevel;
  tile: ReelTile;
}

export interface JourneyScreenProps {
  onTabPress: (tab: BottomTab) => void;
  /** Tile tap → open the movie preview hub for that tile. From the
   *  hub the user picks "Study words" (→ MovieDetail) or "Quiz me"
   *  (→ SetIntro → quiz). */
  onOpenMoviePreview: (payload: MoviePreviewPayload) => void;
}

const WINDOW_WIDTH  = Dimensions.get('window').width;
const WINDOW_HEIGHT = Dimensions.get('window').height;

const TILES_PER_DIAGONAL = 2;
const STEP_X             = 56;
const STEP_Y             = 76;
const TILE_HALF          = 36;   // half of MovieTile's 72px size
const BOTTOM_PAD         = 38 + 28;
const TOP_PAD            = 60;
const CENTER_X           = WINDOW_WIDTH / 2;
const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function JourneyScreen({
  onTabPress: _onTabPress,
  onOpenMoviePreview,
}: JourneyScreenProps) {
  const user = useAuthStore((s) => s.user);
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);
  const insets = useSafeAreaInsets();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // ─── Reel: user picks (auto-seeded on first launch) ────────────────
  const reelTiles = useReelStore((s) => s.tiles);
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

  // ─── Layout ──────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    const offsetFor = (i: number) => {
      const cycle = 2 * TILES_PER_DIAGONAL;
      const p     = i % cycle;
      return (p <= TILES_PER_DIAGONAL ? p : cycle - p) * STEP_X;
    };

    const naturalHeight = BOTTOM_PAD + TOTAL_TILES * STEP_Y + TILE_HALF * 2 + TOP_PAD;
    const totalHeight   = Math.max(WINDOW_HEIGHT + 200, naturalHeight);

    // tile center Y from the top of the scroll content.
    const rTileY = (i: number) => totalHeight - BOTTOM_PAD - TILE_HALF - i * STEP_Y;

    // Color the reel as a climb across the user's CEFR ±0..+N band.
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
      id: `t-${m.tmdb_id}`,
      idx: i,
      tile: m,
      x: CENTER_X - STEP_X + offsetFor(i),
      y: rTileY(i),
      level: levelFor(i),
      label: i + 1,
      poster: m.poster_path ?? null,
      title: m.title,
    }));

    return { tiles, totalHeight, rTileY };
  }, [userLevel, reelTiles, TOTAL_TILES]);

  // ─── Initial scroll offset — computed synchronously ─────────────────
  // ~100 covers notched iPhone safe area + 56pt bar with a small gap.
  const NAV_BUFFER = 100;
  const scrollableHeight = layout.totalHeight + NAV_BUFFER;
  const initialScrollOffset = Math.max(0, scrollableHeight - WINDOW_HEIGHT);

  // ─── Tile press ──────────────────────────────────────────────────────
  // No async fetch on press — the preview hub is a fast UI screen that
  // owns its own loads (per-movie stats, etc.). We just hand off the
  // tile and let the hub take over.
  const [busyTile, setBusyTile] = useState<number | null>(null);
  const handleTilePress = useCallback((i: number) => {
    const t = layout.tiles[i];
    if (!t) return;
    setBusyTile(i);
    onOpenMoviePreview({
      tileIndex: i,
      level: t.level,
      tile: t.tile,
    });
    // Brief lockout so a double-tap doesn't fire twice during the
    // nav transition. The screen unmounts on navigation anyway.
    setTimeout(() => setBusyTile(null), 400);
  }, [layout.tiles, onOpenMoviePreview]);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root} edges={[]}>
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

        <JourneyConnector
          width={WINDOW_WIDTH}
          height={layout.totalHeight}
          points={layout.tiles.map((t) => ({ idx: t.idx, x: t.x, y: t.y, source: 'user' }))}
          completedCount={layout.tiles.length}
        ></JourneyConnector>

        {/* Movie tiles — all evergreen, all tappable. */}
        {layout.tiles.map((t, i) => (
          <MovieTile
            key={t.id}
            idx={t.idx}
            label={t.label}
            level={t.level}
            movie={t.title}
            poster={t.poster}
            centerX={t.x}
            centerY={t.y}
            busy={busyTile === i}
            onPress={() => handleTilePress(i)}
          ></MovieTile>
        ))}

        {/* Empty-state hint while the reel is hydrating / seeding. */}
        {reelHydrated && layout.tiles.length === 0 ? (
          <View
            pointerEvents="none"
            style={[
              s.emptyHint,
              { top: layout.totalHeight - WINDOW_HEIGHT / 2 },
            ]}
          >
            <Text style={s.emptyHintTitle}>Your reel is empty</Text>
            <Text style={s.emptyHintBody}>
              Add movies from the Home tab to start your list.
            </Text>
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* Top fade — viewport-anchored, color-matched to the film stock. */}
      <LinearGradient
        colors={[tc.reelStock, withAlpha(tc.reelStock, 0.5), withAlpha(tc.reelStock, 0)]}
        locations={[0, 0.6, 1]}
        style={[s.topFadeMask, { height: 160 + insets.top }]}
        pointerEvents="none"
      ></LinearGradient>

      {/* Daily-goal strip — viewport-anchored. Activity-based: each
          completed quiz fills one pip; 3/day continues the streak. */}
      <View style={[s.goalStrip, { top: insets.top + 8 }]} pointerEvents="none">
        <View style={s.goalPips}>
          {Array.from({ length: DAILY_GOAL }).map((_, i) => (
            <View
              key={`pip-${i}`}
              style={[
                s.goalPip,
                i < dailyClamped ? s.goalPipFilled : s.goalPipEmpty,
              ]}
            ></View>
          ))}
        </View>
        <Text style={s.goalText} numberOfLines={1}>
          <Text style={s.goalTextStrong}>{dailyClamped} of {DAILY_GOAL}</Text>
          <Text> · ~2 min each · </Text>
          <Text style={s.goalTextStrong}>🔥 {dailyStreak}</Text>
        </Text>
      </View>

    </SafeAreaView>
  );
}

// Returns the input colour with its alpha replaced. Hex inputs are
// converted to rgba; rgba inputs have their alpha overwritten.
function withAlpha(color: string, alpha: number): string {
  const rgba = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)/i);
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: tc.reelStock },

  topFadeMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
    backgroundColor: tc.gold,
  },
  goalPipEmpty: {
    backgroundColor: tc.border,
  },
  goalText: {
    fontSize: 11,
    fontWeight: '600',
    color: tc.textSecondary,
    letterSpacing: 0.2,
  },
  goalTextStrong: {
    color: tc.goldOnSurface,
    fontWeight: '800',
  },

  emptyHint: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  emptyHintTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: tc.goldOnSurface,
    letterSpacing: 0.3,
    marginBottom: 6,
  },
  emptyHintBody: {
    fontSize: 12,
    fontWeight: '600',
    color: tc.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
  },
});

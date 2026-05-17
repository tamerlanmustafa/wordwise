/**
 * JourneyScreen — Journey Reel zigzag built from the user's per-user
 * reel (synced via reelStore). Tile 0 is bottom-most; tile (idx)'s
 * state derives from completedCount + VISIBLE_AHEAD per the spec.
 *
 * Visual layers, bottom → top:
 *   1. JourneyReelBackground (fixed substrate: stock, leaks, grain,
 *      gutters, scratches).
 *   2. ScrollView content:
 *        a. JourneyReelSprockets (perforations + edge codes, scroll
 *           with content so the film unrolls past the gutters).
 *        b. JourneyConnector (path lines between tile centers, behind
 *           tile frames).
 *        c. ReelChips at CEFR-group boundaries.
 *        d. MovieTiles.
 *   3. Top fade (viewport-anchored, color-matched to the stock).
 *   4. Top-right "Add Movies" pill.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../stores/authStore';
import { useReelStore } from '../stores/reelStore';
import { type NodeLevel } from './journey/JourneyNode';
import { type BottomTab } from './GlobalBottomBar';
import { JourneyReelBackground } from './journey/JourneyReelBackground';
import { JourneyReelSprockets } from './journey/JourneyReelSprockets';
import { MovieTile, type TileState } from './journey/MovieTile';
import { JourneyConnector } from './journey/JourneyConnector';
import { ReelChip } from './journey/ReelChip';
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
  /** Open the "Add Movies" picker (search in addToReel mode). */
  onAddMovies: () => void;
}

const WINDOW_WIDTH  = Dimensions.get('window').width;
const WINDOW_HEIGHT = Dimensions.get('window').height;

const VISIBLE_AHEAD      = 9;    // active + 9 inactive = 10 unlocked
const TILES_PER_DIAGONAL = 2;
const STEP_X             = 56;
const STEP_Y             = 62;
const BOTTOM_PAD         = 60;   // headroom for the active tile (92) + TODAY pill
const TOP_PAD            = 60;   // headroom for top fade + REEL chip
const CENTER_X           = WINDOW_WIDTH / 2;
const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
// Maximum tile size used to derive scroll anchors that align the bottom
// tile inside the viewport regardless of which size state it's in.
const ACTIVE_TILE_SIZE = 92;

// How many viewport-heights of scroll the user gets before hitting the
// soft lock. Each completed tile adds STEP_Y more.
const INITIAL_SCROLL_BUDGET = 3 * WINDOW_HEIGHT;

export function JourneyScreen({ onTabPress, onShowSetIntro, completedCount, onAddMovies }: JourneyScreenProps) {
  const user = useAuthStore((s) => s.user);
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);
  const insets = useSafeAreaInsets();

  // ─── Reel: per-user ordered list of movies ──────────────────────────
  const reelMovies = useReelStore((s) => s.movies);
  const reelHydrated = useReelStore((s) => s.hydrated);
  const hydrateReel = useReelStore((s) => s.hydrate);
  useEffect(() => { if (!reelHydrated) hydrateReel(); }, [reelHydrated, hydrateReel]);

  const TOTAL_TILES = reelMovies.length;

  const scrollY   = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Starting scroll offset — computed once during first layout so we can
  // derive the scroll budget relative to "tile 1 at the bottom."
  const startScrollRef = useRef(0);

  // ─── Build tile data ────────────────────────────────────────────────
  // One tile per reel movie, in add-order. Tile 0 is bottom-most (nearest
  // the active position). Each tile's CEFR level is distributed across
  // the user's level → C2 so the reel groups naturally into "reels."
  const layout = useMemo(() => {
    const offsetFor = (i: number) => {
      const cycle = 2 * TILES_PER_DIAGONAL;       // 4
      const p     = i % cycle;
      return (p <= TILES_PER_DIAGONAL ? p : cycle - p) * STEP_X;
    };

    // Distribute movies across visible CEFR levels.
    const userIdx       = Math.max(0, LEVELS.indexOf(userLevel));
    const visibleLevels = LEVELS.slice(userIdx);
    const tilesPerLevel = Math.max(1, Math.ceil(TOTAL_TILES / visibleLevels.length));
    const levelFor = (i: number): NodeLevel => {
      const li = Math.min(visibleLevels.length - 1, Math.floor(i / tilesPerLevel));
      return visibleLevels[li];
    };

    const naturalHeight = BOTTOM_PAD + TOTAL_TILES * STEP_Y + ACTIVE_TILE_SIZE + TOP_PAD;
    const totalHeight   = Math.max(WINDOW_HEIGHT + 200, naturalHeight);

    const tiles: Array<{
      id: string; x: number; y: number;
      level: NodeLevel; label: number;
      poster: string | null;
      title: string; idx: number;
    }> = [];

    for (let i = 0; i < TOTAL_TILES; i++) {
      const m = reelMovies[i];
      // y is the tile *center*, measured from the top of the scroll
      // content. yFromBottom = BOTTOM_PAD + i * STEP_Y per spec.
      const yFromBottom = BOTTOM_PAD + i * STEP_Y;
      tiles.push({
        id: `t-${m.tmdb_id}`,
        idx: i,
        x: CENTER_X - STEP_X + offsetFor(i),
        y: totalHeight - yFromBottom,
        level: levelFor(i),
        label: i + 1,
        poster: m.poster_path ?? null,
        title: m.title,
      });
    }

    // Group boundaries → REEL chips. Chip sits 28px above the top tile
    // (highest idx) of each level group.
    const groups: Array<{
      level: NodeLevel; reelN: number; topY: number;
      allCompleted: boolean; allLocked: boolean;
    }> = [];
    let groupReelN = 1;
    for (const lv of visibleLevels) {
      const inLevel = tiles.filter((t) => t.level === lv);
      if (inLevel.length === 0) continue;
      // Top tile = highest idx → smallest y.
      const topTile = inLevel.reduce((a, b) => (a.idx > b.idx ? a : b));
      groups.push({
        level: lv,
        reelN: groupReelN++,
        topY: topTile.y - 28,
        allCompleted: inLevel.every((t) => t.idx < completedCount),
        allLocked:    inLevel.every((t) => t.idx > completedCount + VISIBLE_AHEAD),
      });
    }

    return { tiles, totalHeight, groups };
  }, [userLevel, reelMovies, TOTAL_TILES, completedCount]);

  // ─── Per-tile state (re-derives when completedCount changes) ─────────
  const tileState = useCallback(
    (i: number): TileState => {
      if (i < completedCount)                          return 'completed';
      if (i === completedCount)                        return 'active';
      if (i <= completedCount + VISIBLE_AHEAD)         return 'inactive';
      return 'locked';
    },
    [completedCount],
  );

  // ─── Restricted content height ───────────────────────────────────────
  // The ScrollView only exposes as much height as the current scroll
  // budget allows. When the user completes a tile the budget grows by
  // STEP_Y and this value ticks up, extending the scrollable area.
  const allowedScrollRange   = INITIAL_SCROLL_BUDGET + completedCount * STEP_Y;
  const restrictedHeight     = startScrollRef.current > 0
    ? Math.min(
        layout.totalHeight,
        startScrollRef.current + allowedScrollRange + WINDOW_HEIGHT,
      )
    : layout.totalHeight; // before first layout use full height (scroll handled in onContentSizeChange)

  // ─── Initial scroll anchor ────────────────────────────────────────────
  const scrolledOnce = useRef(false);
  const onContentSizeChange = (_w: number, h: number) => {
    if (scrolledOnce.current || h <= 0) return;
    scrolledOnce.current = true;
    // Bottom tile center sits at `h - BOTTOM_PAD`. Anchor so that tile
    // appears ~80 + half-tile px above the bottom nav.
    const tile1CenterY     = h - BOTTOM_PAD;
    const desiredViewportY = WINDOW_HEIGHT - 80 - ACTIVE_TILE_SIZE / 2 - 24;
    const startOffset      = Math.max(0, tile1CenterY - desiredViewportY);
    startScrollRef.current = startOffset;
    scrollRef.current?.scrollTo({ y: startOffset, animated: false });
  };

  // ─── Tile press: start quiz for the active tile ──────────────────────
  // Only the active tile (at completedCount) is tappable. Words for
  // tile i are the 5 words at rank offset i*5 within the user's level —
  // tile 0 = 5 easiest, tile 1 = next 5 easiest, etc.
  const [startingTile, setStartingTile] = useState<number | null>(null);

  const handleTilePress = useCallback(async (i: number) => {
    // Only the active tile is meant to be pressable; defensive guard in
    // case state drifts between render and tap.
    if (i !== completedCount || startingTile !== null) return;

    const tile = layout.tiles[i];
    if (!tile) return;
    const group = layout.groups.find((g) => g.level === tile.level);
    const reelNumber = group ? group.reelN : 1;

    setStartingTile(i);
    try {
      const session = await quizApi.startJourneySession(tile.level, i, 5);
      onShowSetIntro({
        session,
        level: tile.level,
        tileIndex: i,
        movie: { title: tile.title, poster_path: tile.poster },
        setNumber: tile.label,
        reelNumber,
      });
    } catch (err: any) {
      Alert.alert('Could not start set', err?.message ?? 'Please try again.');
    } finally {
      setStartingTile(null);
    }
  }, [completedCount, layout.tiles, layout.groups, startingTile, onShowSetIntro]);

  // ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={[]}>
      <JourneyReelBackground />
      <Animated.ScrollView
        ref={scrollRef as any}
        style={{ flex: 1 }}
        contentContainerStyle={{ height: restrictedHeight }}
        onContentSizeChange={onContentSizeChange}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
      >
        {/* Sprockets travel with the scroll content. The gutter bands
            in JourneyReelBackground stay fixed to the viewport, so the
            holes appear to roll past a stationary film-window. */}
        <JourneyReelSprockets width={WINDOW_WIDTH} height={layout.totalHeight} />

        {/* Connector lines — rendered BEHIND the tiles so strokes
            appear to emerge from under each frame. */}
        <JourneyConnector
          width={WINDOW_WIDTH}
          height={layout.totalHeight}
          points={layout.tiles.map((t) => ({ idx: t.idx, x: t.x, y: t.y }))}
          completedCount={completedCount}
        />

        {/* REEL N · LEVEL chips at each group's top boundary. */}
        {layout.groups.map((g) => (
          <ReelChip
            key={`chip-${g.level}`}
            reelN={g.reelN}
            level={g.level}
            top={g.topY}
            completed={g.allCompleted}
            locked={g.allLocked}
          />
        ))}

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
              onPress={() => handleTilePress(i)}
            />
          );
        })}
      </Animated.ScrollView>

      {/* Top-right "Add Movies" button. Sits inside the safe-zone
          (x > 32) so it never collides with the sprocket gutters. */}
      <TouchableOpacity
        style={[
          styles.addBtn,
          { top: insets.top + 10 },
        ]}
        onPress={onAddMovies}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={16} color="#1a1109" />
        <Text style={styles.addBtnText}>Add Movies</Text>
      </TouchableOpacity>

      {/* Empty state — show only when the reel is hydrated and empty. */}
      {reelHydrated && reelMovies.length === 0 ? (
        <View style={styles.emptyState} pointerEvents="box-none">
          <Text style={styles.emptyTitle}>Your reel is empty</Text>
          <Text style={styles.emptySubtitle}>
            Tap "Add Movies" to start building your journey.
          </Text>
        </View>
      ) : null}

      {/* Top fade — softens locked tiles into the film stock as they
          scroll out the top, so they feel like "frames yet to be
          developed." Anchored to viewport top, matches the stock color
          (#1a1109). */}
      <LinearGradient
        colors={['rgba(26,17,9,1)', 'rgba(26,17,9,0.5)', 'rgba(26,17,9,0)']}
        locations={[0, 0.6, 1]}
        style={styles.topFadeMask}
        pointerEvents="none"
      />

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#2E3B2C' },
  topFadeMask: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  addBtn: {
    position: 'absolute',
    right: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,180,80,0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1109',
    letterSpacing: 0.2,
  },
  emptyState: {
    position: 'absolute',
    top: '40%',
    left: 40,
    right: 40,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: 'rgba(255,200,140,0.95)',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255,200,140,0.65)',
    textAlign: 'center',
    lineHeight: 20,
  },
});

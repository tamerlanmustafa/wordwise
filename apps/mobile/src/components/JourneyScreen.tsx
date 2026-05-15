/**
 * JourneyScreen — progressive daily-check-in zigzag.
 *
 * Scroll rules:
 *  • On entry the user starts at tile 1. They can scroll up ~3 viewport
 *    heights before hitting a soft lock.
 *  • The top fade mask is INVISIBLE while they have room to scroll; it
 *    ramps to fully-opaque only as they approach the locked boundary —
 *    tiles recede behind it giving the "the path fades into the future"
 *    illusion.
 *  • When the user taps the active (bottommost) tile and "completes" it,
 *    one tile's worth of scroll (STEP_Y) unlocks at the top, the tile is
 *    marked completed, and the next becomes active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import {
  JourneyNode,
  JOURNEY_NODE_WIDTH,
  JOURNEY_NODE_HEIGHT,
  type NodeState,
  type NodeLevel,
} from './journey/JourneyNode';
import { GlobalBottomBar, type BottomTab } from './GlobalBottomBar';
import { JourneyReelBackground } from './journey/JourneyReelBackground';
import { quizApi, type QuizStartSessionResponse } from '../services/api';

export interface JourneyScreenProps {
  onTabPress: (tab: BottomTab) => void;
  onStartSession: (session: QuizStartSessionResponse, level: string, tileIndex: number) => void;
  /** How many tiles the user has completed so far. Persisted in App.tsx
      so returning from the quiz doesn't reset progress. */
  completedCount: number;
  /** Open the "Add Movies" picker (search in addToReel mode). */
  onAddMovies: () => void;
}

const WINDOW_WIDTH  = Dimensions.get('window').width;
const WINDOW_HEIGHT = Dimensions.get('window').height;

const VISIBLE_AHEAD      = 11;   // active + 11 inactive = 12 unlocked
const TILES_PER_DIAGONAL = 2;
const STEP_X             = 70;
const STEP_Y             = 75;
const BOTTOM_PAD         = 40;
const TOP_PAD            = 30;

// How many viewport-heights of scroll the user gets before hitting the
// soft lock. Each completed tile adds STEP_Y more.
const INITIAL_SCROLL_BUDGET = 3 * WINDOW_HEIGHT;

// How far above the scroll limit the fade starts to ramp in.
const FADE_RAMP = WINDOW_HEIGHT * 0.8;

export function JourneyScreen({ onTabPress, onStartSession, completedCount, onAddMovies }: JourneyScreenProps) {
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
  // the active position). Empty reel → no tiles (CTA shown instead).
  const layout = useMemo(() => {
    const centerX = (WINDOW_WIDTH - JOURNEY_NODE_WIDTH) / 2;
    const offsetFor = (idx: number) => {
      const cycle = 2 * TILES_PER_DIAGONAL;
      const p     = idx % cycle;
      return (p <= TILES_PER_DIAGONAL ? p : cycle - p) * STEP_X;
    };

    const naturalHeight  = BOTTOM_PAD + TOTAL_TILES * STEP_Y + JOURNEY_NODE_HEIGHT + TOP_PAD;
    const totalHeight    = Math.max(WINDOW_HEIGHT + 200, naturalHeight);
    const yCursor        = totalHeight - BOTTOM_PAD;

    const tiles: Array<{
      id: string; x: number; y: number;
      level: NodeLevel; label: number;
      posterUri: string | null;
      title: string;
    }> = [];

    for (let i = 0; i < TOTAL_TILES; i++) {
      const m = reelMovies[i];
      tiles.push({
        id: `t-${m.tmdb_id}`,
        x: centerX - STEP_X + offsetFor(i),
        y: yCursor - JOURNEY_NODE_HEIGHT - i * STEP_Y,
        level: userLevel,
        label: i + 1,
        posterUri: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
        title: m.title,
      });
    }

    return { tiles, totalHeight };
  }, [userLevel, reelMovies, TOTAL_TILES]);

  // ─── Per-tile state (re-derives when completedCount changes) ─────────
  const tileState = useCallback(
    (i: number): NodeState => {
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
    const tile1Y          = h - BOTTOM_PAD - JOURNEY_NODE_HEIGHT;
    const desiredViewportY = WINDOW_HEIGHT - 80 - JOURNEY_NODE_HEIGHT - 24;
    const startOffset      = Math.max(0, tile1Y - desiredViewportY);
    startScrollRef.current = startOffset;
    scrollRef.current?.scrollTo({ y: startOffset, animated: false });
  };

  // ─── Fade mask opacity ────────────────────────────────────────────────
  // 0 while user has room to scroll; ramps to 1 only as they approach the
  // soft lock ceiling (the locked tiles are behind the fade, giving the
  // "path fades into the future" effect).
  const scrollLimit  = startScrollRef.current + allowedScrollRange;
  const fadeStart    = Math.max(0, scrollLimit - FADE_RAMP);
  const fadeMaskOpacity = scrollY.interpolate({
    inputRange:  [fadeStart, scrollLimit],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // ─── Tile press: start quiz for the active tile ──────────────────────
  // Only the active tile (at completedCount) is tappable. Words for
  // tile i are the 5 words at rank offset i*5 within the user's level —
  // tile 0 = 5 easiest, tile 1 = next 5 easiest, etc.
  const [startingTile, setStartingTile] = useState<number | null>(null);

  const handleTilePress = useCallback(async (i: number) => {
    if (i !== completedCount || startingTile !== null) return;
    setStartingTile(i);
    try {
      const session = await quizApi.startJourneySession(userLevel, i, 5);
      onStartSession(session, userLevel, i);
    } catch (e) {
      console.warn('[Journey] start session failed:', e);
    } finally {
      setStartingTile(null);
    }
  }, [completedCount, startingTile, userLevel, onStartSession]);

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
        {layout.tiles.map((t, i) => {
          const state = startingTile === i ? 'active' : tileState(i);
          return (
            <View
              key={t.id}
              style={[styles.tileWrapper, { left: t.x, top: t.y }]}
            >
              <JourneyNode
                level={t.level}
                state={state}
                label={startingTile === i ? '…' : t.label}
                posterUri={t.posterUri}
                onPress={() => handleTilePress(i)}
              />
            </View>
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

      {/* Top fade mask — transparent while the user has scroll room,
          fades to opaque only as they approach the locked boundary so
          the "tiles continuing beyond" illusion kicks in at the right
          moment. Uses native driver via Animated.View opacity. */}
      <Animated.View
        style={[styles.topFadeMask, { opacity: fadeMaskOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['rgba(46,59,44,1)', 'rgba(46,59,44,0.75)', 'rgba(46,59,44,0)']}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
      </Animated.View>

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
    height: 100,
  },
  tileWrapper: {
    position: 'absolute',
    width: JOURNEY_NODE_WIDTH,
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

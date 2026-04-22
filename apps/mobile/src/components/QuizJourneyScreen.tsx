/**
 * QuizJourneyScreen — dynamic upward-scrolling journey UI.
 *
 * Architecture (three stacked layers, all inside one scroll container so
 * they share one scroll offset — see the design blueprint):
 *
 *   ScrollView (AnimatedScrollView; starts scrolled to user-level Y)
 *     ├─ Layer A  Atmosphere   — parallax sky, translateY × 0.3
 *     ├─ Layer B  Path+scenery — SVG <Path> road + repeating biome tiles
 *     └─ Layer C  Nodes        — JourneyNode stack (8-layer composition)
 *
 * The journey starts at the user's *actual* proficiency level and only
 * progresses upward (A1→A2→B1→B2→C1→C2). The list is filtered to
 * `userLevel..C2` so lower levels simply aren't rendered — cleaner than
 * rendering-and-hiding.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, cefrColors, cefrLabels } from '../theme/palette';
import {
  quizApi,
  type QuizUnitState,
  type QuizStartSessionResponse,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  JourneyNode,
  type NodeState as JNodeState,
  type NodeLevel,
} from './journey/JourneyNode';
import { computeJourneyLayout } from './journey/useJourneyLayout';
import { JourneyPath } from './journey/JourneyPath';

export interface QuizJourneyScreenProps {
  // Either a single movie or a batch. Both shapes share the same screen.
  movieId?: number;
  movieIds?: number[];
  movieTitle: string;
  onBack: () => void;
  onStartSession: (session: QuizStartSessionResponse, level: string) => void;
}

const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WINDOW_WIDTH = Dimensions.get('window').width;

export function QuizJourneyScreen({
  movieId,
  movieIds,
  movieTitle,
  onBack,
  onStartSession,
}: QuizJourneyScreenProps) {
  const user = useAuthStore((s) => s.user);
  // User's real level clamps the journey's floor. Fallback to A1 if we
  // somehow don't have a profile — never render below the user's level.
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);

  const [units, setUnits] = useState<QuizUnitState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingLevel, setStartingLevel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const ids = useMemo(() => {
    if (movieIds && movieIds.length > 0) return movieIds;
    if (movieId != null) return [movieId];
    return [];
  }, [movieId, movieIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = ids.length > 1
        ? await quizApi.getBatchUnits(ids)
        : await quizApi.getMovieUnits(ids[0]);
      setUnits(data);
    } catch (e) {
      console.warn('[QuizJourney] load failed:', e);
      setError('Could not load units.');
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => { load(); }, [load]);

  const handleStart = async (level: string) => {
    setStartingLevel(level);
    try {
      const session = ids.length > 1
        ? await quizApi.startBatchSession(ids, level, 'unit')
        : await quizApi.startSession(ids[0], level, 'unit');
      onStartSession(session, level);
    } catch (e) {
      console.warn('[QuizJourney] start failed:', e);
      setError('Could not start session.');
    } finally {
      setStartingLevel(null);
    }
  };

  // ─── Derive the ordered node list (bottom-up) ─────────────────────
  // Journey starts at userLevel and only climbs upward. The backend's
  // `locked` flag assumes progression from A1, but when the journey
  // starts at the user's actual level, the first visible level is
  // ALWAYS available regardless of whether A2/A1 were attempted. We
  // override the backend lock for the starting level accordingly.
  const { layout, visibleLevels } = useMemo(() => {
    const userIdx = Math.max(0, LEVELS.indexOf(userLevel));
    const visible = LEVELS.slice(userIdx); // [userLevel, ..., C2]
    const byLevel = new Map<string, QuizUnitState>();
    (units || []).forEach((u) => byLevel.set(u.level, u));

    // Find the "active" node: first visible level that has words and
    // isn't already completed-to-mastery. That node must visually
    // dominate. Subsequent levels are locked until the active one is
    // completed; earlier levels (rare — only if user completed them on
    // a previous session) read as `completed`.
    let activeAssigned = false;

    const inputs = visible.map((lv, visibleIdx) => {
      const u = byLevel.get(lv);
      const hasWords = !!u && u.word_count > 0;
      const completed = !!u && u.best_stars >= 2;
      // Override the backend lock for the user's starting level —
      // that's always available by definition, even if the user hasn't
      // attempted A1/A2.
      const effectiveLocked = visibleIdx === 0 ? false : (!u || u.locked);

      let state: JNodeState;
      if (!hasWords) {
        state = 'locked';
      } else if (completed) {
        state = 'completed';
      } else if (!effectiveLocked && !activeAssigned) {
        state = 'active';
        activeAssigned = true;
      } else if (effectiveLocked) {
        state = 'locked';
      } else {
        state = 'inactive';
      }
      return { id: lv, level: lv, state };
    });

    // If nothing got the `active` flag (e.g. no unit has words), force
    // the starting level to active anyway — the user should always
    // have something to tap.
    if (!activeAssigned && inputs.length > 0) {
      inputs[0] = { ...inputs[0], state: 'active' };
    }

    return {
      visibleLevels: visible,
      layout: computeJourneyLayout(inputs, WINDOW_WIDTH),
    };
  }, [units, userLevel]);

  // ─── Auto-scroll to the active node on first load ──────────────────
  // We scroll once the content has been measured. Active node should
  // land ~65% down the viewport, not at the bottom, so there's teaser
  // context above.
  const scrolledOnce = useRef(false);
  const onContentSizeChange = (_: number, h: number) => {
    if (scrolledOnce.current) return;
    if (h <= 0) return;
    scrolledOnce.current = true;
    const targetY = layout.activeY ?? h;
    // Align active node at 65% of viewport — scroll offset = targetY
    // minus 0.65 × viewport. Approximate viewport via a guess; overshoot
    // is clamped by the scrollview.
    const viewportGuess = 600;
    const scrollTo = Math.max(0, targetY - viewportGuess * 0.65);
    scrollRef.current?.scrollTo({ y: scrollTo, animated: false });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.headerTitle}>Journey</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {movieTitle} · starts {userLevel}
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !units || units.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No units available yet.</Text>
          <Text style={styles.emptySub}>Classify this movie's script first.</Text>
        </View>
      ) : (
        <Animated.ScrollView
          ref={scrollRef as any}
          style={{ flex: 1 }}
          contentContainerStyle={{ height: layout.totalHeight }}
          onContentSizeChange={onContentSizeChange}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true },
          )}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          {/* ──────────── Layer A — Atmosphere ────────────
              Full-height gradient backdrop that transitions through the
              visible CEFR biomes. Translates slower than the scroll
              (parallax × 0.3) so it visually lags — one of the cheapest
              depth cues available. */}
          <Animated.View
            style={[
              styles.atmosphere,
              {
                height: layout.totalHeight,
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [0, layout.totalHeight],
                      outputRange: [0, layout.totalHeight * -0.3],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="none"
          >
            <AtmosphereGradient visibleLevels={visibleLevels} />
          </Animated.View>

          {/* ──────────── Layer B — Path + scenery ────────────
              The winding SVG road. Sits between atmosphere and nodes,
              aligned 1:1 with scroll (not parallaxed) so nodes stay
              glued to it. */}
          <View style={[styles.pathLayer, { height: layout.totalHeight }]} pointerEvents="none">
            <JourneyPath
              pathD={layout.pathD}
              width={WINDOW_WIDTH}
              height={layout.totalHeight}
            />
          </View>

          {/* ──────────── Layer C — Nodes ────────────
              The tappable, layered JourneyNode stack. Absolute positioned
              by the layout helper so the winding math is the sole source
              of truth for placement. */}
          <View style={[styles.nodesLayer, { height: layout.totalHeight }]}>
            {layout.nodes.map((n) => {
              // The layout hands back node CENTER coords; our JourneyNode
              // is 120×120, so subtract 60 to convert center→top-left.
              const left = n.x - 60;
              const top = n.y - 60;
              const isStarting = startingLevel === n.level;
              return (
                <View
                  key={n.id}
                  style={[styles.nodeWrapper, { left, top }]}
                >
                  <JourneyNode
                    level={n.level as NodeLevel}
                    state={isStarting ? 'active' : (n.state as JNodeState)}
                    onPress={() => handleStart(n.level)}
                  />
                  {/* Per-node caption sits just beneath the tile so the
                      user can read the level name + best-stars without
                      tapping. Stays compact to avoid competing with the
                      node itself. */}
                  <NodeCaption
                    level={n.level}
                    unit={units.find((u) => u.level === n.level)}
                    isStarting={isStarting}
                  />
                </View>
              );
            })}
          </View>
        </Animated.ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * AtmosphereGradient — vertical gradient that passes through the biome
 * color of each visible level in sequence. Locks `visibleLevels` as the
 * only source of the palette; never hardcodes all 6 levels, because the
 * journey can start anywhere.
 */
function AtmosphereGradient({ visibleLevels }: { visibleLevels: NodeLevel[] }) {
  // Biome tints per level — brighter than the node color so the node
  // still dominates when placed on top.
  const biome: Record<NodeLevel, string> = {
    A1: '#DCEDC8',
    A2: '#C5E1A5',
    B1: '#FFECB3',
    B2: '#FFCCBC',
    C1: '#FFCDD2',
    C2: '#E1BEE7',
  };
  // The journey renders top-down, so top of canvas = hardest visible
  // level (last in visibleLevels), bottom = user's level (first).
  const colorsArr = [...visibleLevels].reverse().map((lv) => biome[lv]) as string[];
  // LinearGradient needs ≥ 2 colors — if a user starts at C2 we only
  // have one biome; duplicate it so the API is happy.
  const safeColors = colorsArr.length >= 2 ? colorsArr : [colorsArr[0], colorsArr[0]];
  return (
    <LinearGradient
      colors={safeColors as any}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={StyleSheet.absoluteFillObject}
    />
  );
}

function NodeCaption({
  level,
  unit,
  isStarting,
}: {
  level: string;
  unit?: QuizUnitState;
  isStarting: boolean;
}) {
  const label = cefrLabels[level] || level;
  const color = cefrColors[level] || colors.primary;
  return (
    <View style={styles.caption} pointerEvents="none">
      <View style={[styles.captionChip, { backgroundColor: color }]}>
        <Text style={styles.captionChipText}>{label}</Text>
      </View>
      {unit ? (
        <Text style={styles.captionMeta}>
          {isStarting ? 'Starting…' : `${unit.word_count} words · ${unit.best_stars}/3 ★`}
        </Text>
      ) : (
        <Text style={styles.captionMeta}>No words yet</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#DCEDC8' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  atmosphere: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 0,
  },
  pathLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 1,
  },
  nodesLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 2,
  },
  nodeWrapper: {
    position: 'absolute',
    width: 120,
    alignItems: 'center',
  },

  caption: {
    marginTop: 2,
    alignItems: 'center',
  },
  captionChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  captionChipText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.3 },
  captionMeta: { fontSize: 10, color: colors.text, marginTop: 2,
    backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 6, overflow: 'hidden',
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.error, marginBottom: 12 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  emptyText: { fontSize: 14, color: colors.textSecondary },
  emptySub: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
});

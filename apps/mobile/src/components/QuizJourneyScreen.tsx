/**
 * QuizJourneyScreen — minimal UI test harness.
 *
 * A plain scrollable surface with the 3D tile nodes placed on a winding
 * path (positions only, no drawn line between them). No SVG path, no
 * atmosphere gradient, no scenery, no node captions. Tiles are tappable
 * for press-animation feel but don't launch the quiz yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/palette';
import {
  quizApi,
  type QuizUnitState,
  type QuizStartSessionResponse,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  JourneyNode,
  JOURNEY_NODE_WIDTH,
  JOURNEY_NODE_HEIGHT,
  type NodeState as JNodeState,
  type NodeLevel,
} from './journey/JourneyNode';
import { computeJourneyLayout } from './journey/useJourneyLayout';

export interface QuizJourneyScreenProps {
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
  const userLevel = ((user?.proficiency_level || 'A1').toUpperCase() as NodeLevel);

  const [units, setUnits] = useState<QuizUnitState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

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

  // Kept on the props but intentionally unused in this visual-test mode.
  void onStartSession;

  // Node positions: winding layout placed on an invisible canvas.
  const layout = useMemo(() => {
    const userIdx = Math.max(0, LEVELS.indexOf(userLevel));
    const visible = LEVELS.slice(userIdx);
    const byLevel = new Map<string, QuizUnitState>();
    (units || []).forEach((u) => byLevel.set(u.level, u));

    let activeAssigned = false;
    const inputs = visible.map((lv, visibleIdx) => {
      const u = byLevel.get(lv);
      const hasWords = !!u && u.word_count > 0;
      const completed = !!u && u.best_stars >= 2;
      const effectiveLocked = visibleIdx === 0 ? false : (!u || u.locked);

      let state: JNodeState;
      if (!hasWords) state = 'locked';
      else if (completed) state = 'completed';
      else if (!effectiveLocked && !activeAssigned) {
        state = 'active';
        activeAssigned = true;
      } else if (effectiveLocked) state = 'locked';
      else state = 'inactive';
      return { id: lv, level: lv, state };
    });
    if (!activeAssigned && inputs.length > 0) {
      inputs[0] = { ...inputs[0], state: 'active' };
    }
    return computeJourneyLayout(inputs, WINDOW_WIDTH);
  }, [units, userLevel]);

  const scrolledOnce = useRef(false);
  const onContentSizeChange = (_: number, h: number) => {
    if (scrolledOnce.current || h <= 0) return;
    scrolledOnce.current = true;
    const targetY = layout.activeY ?? h;
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
          <Text style={styles.headerSubtitle} numberOfLines={1}>{movieTitle}</Text>
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
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ height: layout.totalHeight }}
          onContentSizeChange={onContentSizeChange}
          showsVerticalScrollIndicator={false}
        >
          {layout.nodes.map((n) => {
            const left = n.x - JOURNEY_NODE_WIDTH / 2;
            const top = n.y - JOURNEY_NODE_HEIGHT / 2;
            return (
              <View
                key={n.id}
                style={[styles.nodeWrapper, { left, top }]}
              >
                <JourneyNode
                  level={n.level as NodeLevel}
                  state={n.state as JNodeState}
                  onPress={() => { /* visual test — no-op */ }}
                />
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#A2CB8B' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  nodeWrapper: {
    position: 'absolute',
    width: JOURNEY_NODE_WIDTH,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.error, marginBottom: 12 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  emptyText: { fontSize: 14, color: colors.textSecondary },
});

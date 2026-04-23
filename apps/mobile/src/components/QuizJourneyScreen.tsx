/**
 * QuizJourneyScreen — dynamic journey built from word counts per CEFR level.
 *
 * Each tile represents `WORDS_PER_TILE` (10) words. The journey includes
 * the user's current level and every level above (never below). Colors
 * come from the level itself — if the movie has 100 B1 words and the
 * user is B1, you'll see 10 B1-green tiles first, then however many
 * B2 / C1 / C2 tiles fit the remaining word counts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
  type QuizStartSessionResponse,
  type QuizUnitState,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  JourneyNode,
  JOURNEY_NODE_WIDTH,
  JOURNEY_NODE_HEIGHT,
  type NodeState,
  type NodeLevel,
} from './journey/JourneyNode';

export interface QuizJourneyScreenProps {
  movieId?: number;
  movieIds?: number[];
  movieTitle: string;
  onBack: () => void;
  onStartSession: (session: QuizStartSessionResponse, level: string) => void;
}

// Tuning knobs.
const WORDS_PER_TILE = 10;
const TILES_PER_DIAGONAL = 2;
const STEP_X = 70;
const STEP_Y = 75;
const LEVELS: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const WINDOW_WIDTH = Dimensions.get('window').width;

export function QuizJourneyScreen({
  movieId,
  movieIds,
  movieTitle,
  onBack,
  onStartSession,
}: QuizJourneyScreenProps) {
  void onStartSession; // tapping is a no-op while we tune the UI

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

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = ids.length > 1
          ? await quizApi.getBatchUnits(ids)
          : await quizApi.getMovieUnits(ids[0]);
        if (!cancelled) setUnits(data);
      } catch (e) {
        console.warn('[QuizJourney] load failed:', e);
        if (!cancelled) setError('Could not load units.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ids]);

  // Build the tile sequence. Walk levels user → C2; within each level,
  // emit ceil(word_count / 10) tiles of that level's color. Positions
  // are laid out in the existing zigzag pattern.
  const { tiles, totalHeight } = useMemo(() => {
    if (!units) return { tiles: [], totalHeight: 0 };

    const userIdx = Math.max(0, LEVELS.indexOf(userLevel));
    const visible = LEVELS.slice(userIdx);
    const byLevel = new Map<string, QuizUnitState>();
    units.forEach((u) => byLevel.set(u.level, u));

    const zigzagRange = STEP_X * TILES_PER_DIAGONAL;
    const startX = (WINDOW_WIDTH - JOURNEY_NODE_WIDTH) / 2 - zigzagRange / 2;

    const out: Array<{ id: string; x: number; y: number; level: NodeLevel; state: NodeState }> = [];

    let x = startX;
    let i = 0;
    let activeAssigned = false;

    for (const lv of visible) {
      const u = byLevel.get(lv);
      const words = u?.word_count ?? 0;
      if (words <= 0) continue;

      const tilesForLevel = Math.ceil(words / WORDS_PER_TILE);
      const levelCompleted = !!u && u.best_stars >= 2;
      const levelUnlocked = lv === visible[0] || !u?.locked; // user's own level always unlocked

      for (let k = 0; k < tilesForLevel; k++) {
        const segment = Math.floor(i / TILES_PER_DIAGONAL);
        const dir = segment % 2 === 0 ? +1 : -1;

        let state: NodeState;
        if (levelCompleted) {
          state = 'completed';
        } else if (levelUnlocked && !activeAssigned) {
          state = 'active';
          activeAssigned = true;
        } else if (levelUnlocked) {
          state = 'inactive';
        } else {
          state = 'locked';
        }

        out.push({
          id: `${lv}-${k}`,
          x,
          y: 20 + i * STEP_Y,
          level: lv,
          state,
        });
        x += STEP_X * dir;
        i++;
      }
    }

    // Fallback: if no levels had words, drop one teaser tile so the
    // screen isn't empty.
    if (out.length === 0) {
      out.push({ id: 'empty-0', x: startX, y: 20, level: userLevel, state: 'inactive' });
    }

    const height = 40 + Math.max(1, i) * STEP_Y + JOURNEY_NODE_HEIGHT;
    return { tiles: out, totalHeight: height };
  }, [units, userLevel]);

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
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ height: totalHeight }}
          showsVerticalScrollIndicator={false}
        >
          {tiles.map((t) => (
            <View
              key={t.id}
              style={[styles.tileWrapper, { left: t.x, top: t.y }]}
            >
              <JourneyNode level={t.level} state={t.state} onPress={() => { /* no-op */ }} />
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2E3B2C' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  tileWrapper: {
    position: 'absolute',
    width: JOURNEY_NODE_WIDTH,
  },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#FFFFFF', opacity: 0.7 },
});

/**
 * QuizJourneyScreen — visual-test harness for the diamond tile UI.
 *
 * Renders N tiles in a zigzag chain: 3 tiles drift diagonally one way,
 * the next 3 go the other way, repeating. No API calls, no CEFR
 * gating — just the visual pattern while we tune the look. Hook this
 * back up to `quizApi` once we're happy with the tiles.
 */

import { useMemo, useRef } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/palette';
import type { QuizStartSessionResponse } from '../services/api';
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

// Tuning knobs for the zigzag layout.
const TILE_COUNT = 24;               // how many tiles total
const TILES_PER_DIAGONAL = 2;        // 3 drift one way, 3 the other, repeat
const STEP_X = 70;                   // horizontal offset per tile (zigzag amplitude × 3)
const STEP_Y = 75;                   // vertical offset per tile (how fast the chain descends)
const COLOR_CYCLE: NodeLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const WINDOW_WIDTH = Dimensions.get('window').width;

export function QuizJourneyScreen({
  movieTitle,
  onBack,
  // Props kept for App.tsx compatibility; intentionally unused while
  // we focus on the UI tiles.
  movieId,
  movieIds,
  onStartSession,
}: QuizJourneyScreenProps) {
  void movieId; void movieIds; void onStartSession;

  const scrollRef = useRef<ScrollView>(null);

  // Zigzag positions. The X coordinate walks +STEP_X for TILES_PER_DIAGONAL
  // tiles, then -STEP_X for the next TILES_PER_DIAGONAL, and so on. Y is
  // monotonic. Result: diamonds march diagonally in 3-at-a-time runs.
  const { tiles, totalHeight } = useMemo(() => {
    // Start X chosen so the zigzag bounces around screen center.
    const zigzagRange = STEP_X * TILES_PER_DIAGONAL;
    const startX = (WINDOW_WIDTH - JOURNEY_NODE_WIDTH) / 2 - zigzagRange / 2;

    const out: Array<{
      id: string;
      x: number;
      y: number;
      level: NodeLevel;
      state: NodeState;
    }> = [];

    let x = startX;
    for (let i = 0; i < TILE_COUNT; i++) {
      const segment = Math.floor(i / TILES_PER_DIAGONAL);
      const dir = segment % 2 === 0 ? +1 : -1;
      const level = COLOR_CYCLE[i % COLOR_CYCLE.length];

      // Visual-test state pattern: first few completed, one active,
      // rest inactive/locked. Nothing data-driven here.
      let state: NodeState = 'inactive';
      if (i < 3) state = 'completed';
      else if (i === 3) state = 'active';
      else if (i > 12) state = 'locked';

      out.push({ id: `tile-${i}`, x, y: 20 + i * STEP_Y, level, state });
      x += STEP_X * dir;
    }

    const height = 40 + TILE_COUNT * STEP_Y + JOURNEY_NODE_HEIGHT;
    return { tiles: out, totalHeight: height };
  }, []);

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
            <JourneyNode level={t.level} state={t.state} onPress={() => { /* visual test — no-op */ }} />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2E3B2C' }, // dark green, game-board feel
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
});

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
import { colors, cefrColors, cefrLabels } from '../theme/palette';
import { quizApi, type QuizUnitState, type QuizStartSessionResponse } from '../services/api';

export interface QuizJourneyScreenProps {
  // Either a single movie or a batch. Both shapes share the same screen.
  movieId?: number;
  movieIds?: number[];
  movieTitle: string;
  onBack: () => void;
  onStartSession: (session: QuizStartSessionResponse, level: string) => void;
}

const WINDOW_WIDTH = Dimensions.get('window').width;

// One tileable background tile — repeated vertically to cover any scroll
// length without per-band layout math. Emoji positions are fixed relative
// to the tile so it seamlessly repeats.
const TILE_HEIGHT = 160;
const TILE_SCENERY = [
  { emoji: '🌲', left: 0.08, top: 20, size: 22 },
  { emoji: '🌿', left: 0.3, top: 100, size: 14 },
  { emoji: '🍄', left: 0.55, top: 60, size: 14 },
  { emoji: '🌳', left: 0.78, top: 25, size: 22 },
  { emoji: '🌱', left: 0.18, top: 130, size: 12 },
  { emoji: '🌿', left: 0.88, top: 115, size: 14 },
];

export function QuizJourneyScreen({
  movieId,
  movieIds,
  movieTitle,
  onBack,
  onStartSession,
}: QuizJourneyScreenProps) {
  const [units, setUnits] = useState<QuizUnitState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingLevel, setStartingLevel] = useState<string | null>(null);
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

  const handleStart = async (unit: QuizUnitState) => {
    if (unit.locked) return;
    setStartingLevel(unit.level);
    try {
      const session = ids.length > 1
        ? await quizApi.startBatchSession(ids, unit.level, 'unit')
        : await quizApi.startSession(ids[0], unit.level, 'unit');
      onStartSession(session, unit.level);
    } catch (e) {
      console.warn('[QuizJourney] start failed:', e);
      setError('Could not start session.');
    } finally {
      setStartingLevel(null);
    }
  };

  // A1 at the bottom, C2 at the top. ScrollView still paints top-down, so
  // we reverse the list and auto-scroll to the very bottom on mount.
  const ordered = units ? [...units].reverse() : [];

  // One background tile per ~TILE_HEIGHT of road, plus a small buffer.
  // Re-computed when units change (journey grows/shrinks).
  const tilesNeeded = Math.max(6, ordered.length * 2);

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
          <Text style={styles.emptySub}>Classify this movie's script first.</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          onContentSizeChange={(_, h) => scrollRef.current?.scrollTo({ y: h, animated: false })}
        >
          {/* Repeating tile background — one view per tile, all identical. */}
          <View style={styles.bgLayer} pointerEvents="none">
            {Array.from({ length: tilesNeeded }).map((_, i) => (
              <BackgroundTile key={i} />
            ))}
          </View>

          {/* Foreground: the units (top = hardest, bottom = A1) */}
          <View style={styles.roadLayer}>
            {ordered.map((unit, idx) => {
              const originalIdx = ordered.length - 1 - idx;
              const side = originalIdx % 2 === 0 ? 'left' : 'right';
              const isStarting = startingLevel === unit.level;
              return (
                <UnitStump
                  key={unit.level}
                  unit={unit}
                  color={cefrColors[unit.level] || colors.primary}
                  side={side}
                  isStarting={isStarting}
                  onPress={() => handleStart(unit)}
                />
              );
            })}
          </View>

          <Text style={styles.introText}>
            Your journey starts here — climb up to harder levels.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// The one-and-only background tile. All tiles are identical so the image
// appears to repeat seamlessly down the road.
function BackgroundTile() {
  return (
    <View style={styles.tile}>
      {TILE_SCENERY.map((s, i) => (
        <Text
          key={i}
          style={[
            styles.scenery,
            { left: s.left * WINDOW_WIDTH, top: s.top, fontSize: s.size },
          ]}
        >
          {s.emoji}
        </Text>
      ))}
    </View>
  );
}

interface UnitStumpProps {
  unit: QuizUnitState;
  color: string;
  side: 'left' | 'right';
  isStarting: boolean;
  onPress: () => void;
}

// Tree-stump orb: concentric rings mimic growth rings, bark rim sits outside.
// Color of each ring is shaded off the CEFR base color — A1 is green-stump,
// C2 is purple-stump, etc., so each level feels like a different kind of wood.
function UnitStump({ unit, color, side, isStarting, onPress }: UnitStumpProps) {
  const label = cefrLabels[unit.level] || unit.level;
  const isLocked = unit.locked;
  const bark = shade(color, -0.45);
  const outerWood = shade(color, -0.15);
  const midWood = color;
  const innerWood = shade(color, 0.25);
  const coreWood = shade(color, 0.4);

  return (
    <View style={[styles.stumpRow, side === 'right' && styles.stumpRowRight]}>
      <TouchableOpacity
        onPress={onPress}
        disabled={isLocked || isStarting}
        activeOpacity={0.85}
        style={styles.stumpTouchable}
      >
        {/* Ground-shadow oval underneath */}
        <View style={styles.stumpGroundShadow} />
        {/* Concentric rings — bark → outermost wood → ... → core */}
        <View style={[styles.ring, styles.ringBark, { backgroundColor: bark }]} />
        <View style={[styles.ring, styles.ringOuter, { backgroundColor: outerWood }]} />
        <View style={[styles.ring, styles.ringMid, { backgroundColor: midWood }]} />
        <View style={[styles.ring, styles.ringInner, { backgroundColor: innerWood }]} />
        <View style={[styles.ring, styles.ringCore, { backgroundColor: coreWood }]}>
          <Text style={styles.stumpLabel}>{unit.level}</Text>
        </View>
        {isLocked && (
          <View style={styles.lockOverlay}>
            <Text style={styles.lockIcon}>🔒</Text>
          </View>
        )}
        {isStarting && (
          <View style={styles.lockOverlay}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.caption}>
        <Text style={[styles.captionLabel, isLocked && styles.captionLocked]}>{label}</Text>
        <Text style={styles.captionMeta}>
          {unit.word_count} word{unit.word_count === 1 ? '' : 's'}
        </Text>
        <View style={styles.starsRow}>
          {[1, 2, 3].map((n) => (
            <Text key={n} style={styles.star}>
              {n <= unit.best_stars ? '⭐' : '☆'}
            </Text>
          ))}
        </View>
        {unit.attempts > 0 && (
          <Text style={styles.attemptsText}>{unit.attempts} attempt{unit.attempts === 1 ? '' : 's'}</Text>
        )}
        {isLocked && (
          <Text style={styles.lockText}>Finish previous level</Text>
        )}
      </View>
    </View>
  );
}

// Lighten/darken a hex color by factor in [-1, 1].
function shade(hex: string, factor: number): string {
  const n = hex.replace('#', '');
  if (n.length !== 6) return hex;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (factor < 0 ? v * factor : (255 - v) * factor))));
  return `#${[f(r), f(g), f(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const STUMP_OUTER = 120;
const STUMP_BARK = STUMP_OUTER + 10;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#DCEDC8' }, // soft meadow base
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  scroll: { paddingBottom: 32, position: 'relative' },

  // Repeating background layer: stacked identical tiles.
  bgLayer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  tile: {
    width: WINDOW_WIDTH,
    height: TILE_HEIGHT,
    backgroundColor: '#DCEDC8',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.03)',
  },
  scenery: { position: 'absolute', opacity: 0.75 },

  // Foreground road column.
  roadLayer: { paddingTop: 24, paddingBottom: 24, zIndex: 1 },

  introText: {
    fontSize: 12, color: colors.text, textAlign: 'center',
    marginTop: 12, paddingHorizontal: 24,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingVertical: 8, marginHorizontal: 40, borderRadius: 12,
    overflow: 'hidden',
  },

  stumpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  stumpRowRight: { flexDirection: 'row-reverse' },
  stumpTouchable: {
    width: STUMP_BARK, height: STUMP_BARK,
    alignItems: 'center', justifyContent: 'center',
  },
  stumpGroundShadow: {
    position: 'absolute',
    bottom: -4,
    width: STUMP_BARK + 6,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.18)',
    opacity: 0.6,
  },

  // Concentric ring stack — all absolute-positioned, centered.
  ring: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringBark: {
    width: STUMP_BARK, height: STUMP_BARK,
    borderRadius: STUMP_BARK / 2,
  },
  ringOuter: {
    width: STUMP_OUTER, height: STUMP_OUTER,
    borderRadius: STUMP_OUTER / 2,
  },
  ringMid: {
    width: STUMP_OUTER * 0.78, height: STUMP_OUTER * 0.78,
    borderRadius: (STUMP_OUTER * 0.78) / 2,
  },
  ringInner: {
    width: STUMP_OUTER * 0.56, height: STUMP_OUTER * 0.56,
    borderRadius: (STUMP_OUTER * 0.56) / 2,
  },
  ringCore: {
    width: STUMP_OUTER * 0.38, height: STUMP_OUTER * 0.38,
    borderRadius: (STUMP_OUTER * 0.38) / 2,
  },
  stumpLabel: {
    fontSize: 20, fontWeight: '900', color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  caption: {
    marginHorizontal: 10,
    paddingVertical: 6, paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    maxWidth: WINDOW_WIDTH * 0.42,
  },
  captionLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  captionLocked: { color: colors.textSecondary },
  captionMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  starsRow: { flexDirection: 'row', marginTop: 4, gap: 2 },
  star: { fontSize: 14 },
  attemptsText: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  lockText: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },

  lockOverlay: {
    position: 'absolute',
    width: STUMP_BARK, height: STUMP_BARK,
    borderRadius: STUMP_BARK / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  lockIcon: { fontSize: 28 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.error, marginBottom: 12 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  emptyText: { fontSize: 14, color: colors.textSecondary },
  emptySub: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, cefrColors } from '../theme/palette';
import { wordwiseApi } from '../services/api';

export interface QuizBatchBuilderScreenProps {
  userLevel?: string | null;
  onBack: () => void;
  onStart: (movieIds: number[], title: string) => void;
}

interface MovieCandidate {
  movie_id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  difficulty_score: number | null;
}

const MIN_SELECT = 3;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// Build-a-journey: user hand-picks 3+ movies whose vocab will be pooled into
// one long journey. Filter chip lets them browse across CEFR levels.
export function QuizBatchBuilderScreen({ userLevel, onBack, onStart }: QuizBatchBuilderScreenProps) {
  const initialLevel = (userLevel || 'B1').toUpperCase();
  const [activeLevel, setActiveLevel] = useState<string>(LEVELS.includes(initialLevel) ? initialLevel : 'B1');
  const [movies, setMovies] = useState<MovieCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const load = useCallback(async (level: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await wordwiseApi.getMoviesByCefr(level, 50);
      setMovies(data.movies as MovieCandidate[]);
    } catch (e) {
      console.warn('[BatchBuilder] load failed:', e);
      setError('Could not load movies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeLevel); }, [load, activeLevel]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedList = useMemo(() => Array.from(selected), [selected]);
  const canStart = selectedList.length >= MIN_SELECT;

  const handleStart = () => {
    if (!canStart) return;
    const title = selectedList.length === 1
      ? (movies.find((m) => m.movie_id === selectedList[0])?.title || 'Journey')
      : `${selectedList.length} movies`;
    onStart(selectedList, title);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Build Journey</Text>
        <View style={{ width: 60 }} />
      </View>

      <Text style={styles.hint}>
        Pick at least {MIN_SELECT} movies. Their vocabulary will be combined into one long journey.
      </Text>

      <View style={styles.chipsRow}>
        {LEVELS.map((lv) => {
          const isActive = lv === activeLevel;
          return (
            <TouchableOpacity
              key={lv}
              onPress={() => setActiveLevel(lv)}
              style={[
                styles.chip,
                isActive && { backgroundColor: cefrColors[lv], borderColor: cefrColors[lv] },
              ]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{lv}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(activeLevel)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : movies.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No movies at this level.</Text>
        </View>
      ) : (
        <FlatList
          data={movies}
          keyExtractor={(m) => String(m.movie_id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.movie_id);
            return (
              <TouchableOpacity
                onPress={() => toggle(item.movie_id)}
                style={[styles.row, isSelected && styles.rowSelected]}
                activeOpacity={0.7}
              >
                <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                  {isSelected && <Text style={styles.checkboxMark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowMeta}>
                    {item.year ?? '—'}{item.difficulty_score != null ? ` · ${item.difficulty_score}% difficulty` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerCount}>
          {selectedList.length}/{MIN_SELECT}+ selected
        </Text>
        <TouchableOpacity
          onPress={handleStart}
          disabled={!canStart}
          style={[styles.startBtn, !canStart && styles.startBtnDisabled]}
        >
          <Text style={styles.startBtnText}>Start Journey</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backText: { fontSize: 16, color: colors.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },

  hint: {
    fontSize: 12, color: colors.textSecondary,
    paddingHorizontal: 20, paddingVertical: 12, textAlign: 'center',
  },

  chipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  chipTextActive: { color: '#FFFFFF' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: colors.paper,
    borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 8,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: '#F4EEFF' },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
    backgroundColor: colors.paper,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: '#FFFFFF', fontWeight: '700' },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.paper,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  footerCount: { fontSize: 13, color: colors.text, fontWeight: '600' },
  startBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 10,
  },
  startBtnDisabled: { opacity: 0.4 },
  startBtnText: { color: '#FFFFFF', fontWeight: '800' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: colors.error, marginBottom: 12 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  emptyText: { fontSize: 14, color: colors.textSecondary },
});

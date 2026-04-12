import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { socialApi, type LeaderboardResponse, type LeaderboardEntry } from '../services/api';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
  highlight: '#F0EBFF',
};

type Board = 'words' | 'streak' | 'reviews';

const BOARD_LABELS: Record<Board, string> = {
  words: 'Words Saved',
  streak: 'Longest Streak',
  reviews: 'Total Reviews',
};

export interface LeaderboardScreenProps {
  onBack: () => void;
}

export function LeaderboardScreen({ onBack }: LeaderboardScreenProps) {
  const [board, setBoard] = useState<Board>('words');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = board === 'words'
        ? await socialApi.leaderboardWords()
        : board === 'streak'
          ? await socialApi.leaderboardStreak()
          : await socialApi.leaderboardReviews();
      setData(resp);
    } catch (e) {
      console.warn('[Leaderboard] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [board]);

  useEffect(() => { load(); }, [load]);

  const medalColor = (rank: number) => {
    if (rank === 1) return COLORS.gold;
    if (rank === 2) return COLORS.silver;
    if (rank === 3) return COLORS.bronze;
    return COLORS.textTertiary;
  };

  const renderItem = ({ item }: { item: LeaderboardEntry }) => (
    <View style={[styles.row, item.is_you && styles.rowHighlight]}>
      <Text style={[styles.rank, { color: medalColor(item.rank) }]}>
        {item.rank <= 3 ? ['🥇', '🥈', '🥉'][item.rank - 1] : `#${item.rank}`}
      </Text>
      <Text style={[styles.username, item.is_you && styles.usernameBold]} numberOfLines={1}>
        {item.username}{item.is_you ? ' (you)' : ''}
      </Text>
      <Text style={styles.score}>{item.score.toLocaleString()}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Leaderboard</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        {(['words', 'streak', 'reviews'] as Board[]).map((b) => (
          <TouchableOpacity
            key={b}
            style={[styles.tab, board === b && styles.tabActive]}
            onPress={() => setBoard(b)}
          >
            <Text style={[styles.tabText, board === b && styles.tabTextActive]}>
              {BOARD_LABELS[b]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {data?.your_rank != null && (
        <View style={styles.yourRank}>
          <Text style={styles.yourRankText}>
            Your rank: #{data.your_rank} ({data.your_score?.toLocaleString()})
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={data?.entries || []}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.rank}-${item.username}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No data yet. Start learning!</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: COLORS.paper,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  tabs: { flexDirection: 'row', padding: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: COLORS.paper, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  yourRank: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: COLORS.highlight },
  yourRankText: { fontSize: 14, fontWeight: '700', color: COLORS.primary, textAlign: 'center' },
  list: { padding: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: COLORS.paper, borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  rowHighlight: { backgroundColor: COLORS.highlight, borderColor: COLORS.primary },
  rank: { fontSize: 16, fontWeight: '800', width: 44, textAlign: 'center' },
  username: { flex: 1, fontSize: 15, color: COLORS.text, marginLeft: 8 },
  usernameBold: { fontWeight: '700', color: COLORS.primary },
  score: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: COLORS.textTertiary },
});

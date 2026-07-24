import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { getFormattingLocale } from '../i18n';
import { BACK_ARROW } from '../i18n/rtl';
import {
  socialApi,
  quizApi,
  type LeaderboardResponse,
  type LeaderboardEntry,
  type QuizLeaderboardEntry,
  type QuizLeaderboardMetric,
} from '../services/api';
import { useThemeColors, type ThemeColors } from '../theme/tokens';

// Medal/highlight colors are symbolic and stay constant across themes.
const MEDAL = {
  gold:   '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
};

// Top-level section split: vocabulary stats vs quiz stats. Keeps the existing
// social boards one tap away while adding the new quiz metrics without
// cramming 6+ pills into a single row.
type Section = 'vocab' | 'quiz';
type VocabBoard = 'words' | 'streak' | 'reviews';
type QuizBoard = QuizLeaderboardMetric; // 'stars' | 'xp' | 'retention'

// Board ids double as their key under `stats:leaderboard.*`, so no map is
// needed — resolving at render is what keeps them following the app language.

// Normalized row the table renders, regardless of which API fed it.
interface BoardRow {
  rank: number;
  username: string;
  score: number;
  isYou: boolean;
}

export interface LeaderboardScreenProps {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
}

export function LeaderboardScreen({ onBack, backLabel }: LeaderboardScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  const [section, setSection] = useState<Section>('vocab');
  const [vocabBoard, setVocabBoard] = useState<VocabBoard>('words');
  const [quizBoard, setQuizBoard] = useState<QuizBoard>('stars');
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [yourRank, setYourRank] = useState<{ rank: number; score: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'vocab') {
        const resp: LeaderboardResponse =
          vocabBoard === 'words' ? await socialApi.leaderboardWords()
          : vocabBoard === 'streak' ? await socialApi.leaderboardStreak()
          : await socialApi.leaderboardReviews();
        setRows(
          (resp.entries || []).map((e: LeaderboardEntry) => ({
            rank: e.rank,
            username: e.username,
            score: e.score,
            isYou: !!e.is_you,
          })),
        );
        setYourRank(
          resp.your_rank != null && resp.your_score != null
            ? { rank: resp.your_rank, score: resp.your_score }
            : null,
        );
      } else {
        const [board, me] = await Promise.all([
          quizApi.getLeaderboard(quizBoard, 50),
          quizApi.getMyRank(quizBoard).catch(() => null),
        ]);
        const myId = me?.me?.user_id;
        setRows(
          board.map((e: QuizLeaderboardEntry) => ({
            rank: e.rank,
            username: e.username,
            score:
              quizBoard === 'stars' ? e.total_stars
              : quizBoard === 'xp' ? e.xp
              : Math.round(e.retention_score * 100),
            isYou: myId != null && e.user_id === myId,
          })),
        );
        if (me && me.rank != null && me.me) {
          const myValue =
            quizBoard === 'stars' ? me.me.total_stars
            : quizBoard === 'xp' ? me.me.xp
            : Math.round(me.me.retention_score * 100);
          setYourRank({ rank: me.rank, score: myValue });
        } else {
          setYourRank(null);
        }
      }
    } catch (e) {
      console.warn('[Leaderboard] load failed:', e);
      setRows([]);
      setYourRank(null);
    } finally {
      setLoading(false);
    }
  }, [section, vocabBoard, quizBoard]);

  useEffect(() => { load(); }, [load]);

  const medalColor = (rank: number) => {
    if (rank === 1) return MEDAL.gold;
    if (rank === 2) return MEDAL.silver;
    if (rank === 3) return MEDAL.bronze;
    return tc.textMuted;
  };

  const renderItem = ({ item }: { item: BoardRow }) => (
    <View style={[styles.row, item.isYou && styles.rowHighlight]}>
      <Text style={[styles.rank, { color: medalColor(item.rank) }]}>
        {item.rank <= 3 ? ['🥇', '🥈', '🥉'][item.rank - 1] : `#${item.rank}`}
      </Text>
      <Text style={[styles.username, item.isYou && styles.usernameBold]} numberOfLines={1}>
        {item.isYou ? t('stats:leaderboard.you', { username: item.username }) : item.username}
      </Text>
      <Text style={styles.score}>
        {item.score.toLocaleString(getFormattingLocale())}
        {section === 'quiz' && quizBoard === 'retention' ? '%' : ''}
      </Text>
    </View>
  );

  const activeLabel = t(`stats:leaderboard.${section === 'vocab' ? vocabBoard : quizBoard}`);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('stats:leaderboard.screenTitle')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Section toggle — Vocabulary vs Quiz. */}
      <View style={styles.sectionRow}>
        {(['vocab', 'quiz'] as Section[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.sectionBtn, section === s && styles.sectionBtnActive]}
            onPress={() => setSection(s)}
          >
            <Text style={[styles.sectionBtnText, section === s && styles.sectionBtnTextActive]}>
              {s === 'vocab' ? 'Vocabulary' : 'Quiz'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Metric tabs for the chosen section. */}
      <View style={styles.tabs}>
        {section === 'vocab'
          ? (['words', 'streak', 'reviews'] as VocabBoard[]).map((b) => (
              <TouchableOpacity
                key={b}
                style={[styles.tab, vocabBoard === b && styles.tabActive]}
                onPress={() => setVocabBoard(b)}
              >
                <Text style={[styles.tabText, vocabBoard === b && styles.tabTextActive]}>
                  {t(`stats:leaderboard.${b}`)}
                </Text>
              </TouchableOpacity>
            ))
          : (['stars', 'xp', 'retention'] as QuizBoard[]).map((b) => (
              <TouchableOpacity
                key={b}
                style={[styles.tab, quizBoard === b && styles.tabActive]}
                onPress={() => setQuizBoard(b)}
              >
                <Text style={[styles.tabText, quizBoard === b && styles.tabTextActive]}>
                  {t(`stats:leaderboard.${b}`)}
                </Text>
              </TouchableOpacity>
            ))}
      </View>

      {yourRank && (
        <View style={styles.yourRank}>
          <Text style={styles.yourRankText}>
            {t('stats:leaderboard.yourRank', {
              rank: yourRank.rank,
              score: yourRank.score.toLocaleString(getFormattingLocale()),
              suffix: section === 'quiz' && quizBoard === 'retention' ? '%' : '',
            })}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={tc.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={(item) => `${activeLabel}-${item.rank}-${item.username}`}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                {section === 'quiz'
                  ? t('stats:leaderboard.emptyQuiz')
                  : t('stats:leaderboard.emptyVocab')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: tc.paper,
    borderBottomWidth: 1, borderBottomColor: tc.border,
  },
  backText: { fontSize: 16, color: tc.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: tc.text },
  sectionRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, gap: 8,
  },
  sectionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: tc.paper, alignItems: 'center',
    borderWidth: 1, borderColor: tc.border,
  },
  sectionBtnActive: { backgroundColor: tc.text, borderColor: tc.text },
  sectionBtnText: { fontSize: 13, fontWeight: '700', color: tc.textSecondary },
  sectionBtnTextActive: { color: tc.paper },
  tabs: { flexDirection: 'row', padding: 12, gap: 8 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: tc.paper, alignItems: 'center',
    borderWidth: 1, borderColor: tc.border,
  },
  tabActive: { backgroundColor: tc.primary, borderColor: tc.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: tc.textSecondary },
  tabTextActive: { color: '#FFFFFF' },
  yourRank: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: tc.primary + '18' },
  yourRankText: { fontSize: 14, fontWeight: '700', color: tc.primary, textAlign: 'center' },
  list: { padding: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
    backgroundColor: tc.paper, borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: tc.border,
  },
  rowHighlight: { backgroundColor: tc.primary + '18', borderColor: tc.primary },
  rank: { fontSize: 16, fontWeight: '800', width: 44, textAlign: 'center' },
  username: { flex: 1, fontSize: 15, color: tc.text, marginStart: 8 },
  usernameBold: { fontWeight: '700', color: tc.primary },
  score: { fontSize: 15, fontWeight: '700', color: tc.text },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 14, color: tc.textMuted, textAlign: 'center', paddingHorizontal: 24 },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { srsApi, premiumApi, wordwiseApi, type SrsStats } from '../services/api';
import { useIsPremium } from '../stores/entitlementsStore';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { ContributionCalendar } from './stats/ContributionCalendar';
import { calendarIntensity } from './stats/statsSelectors';
import { Skeleton } from './ui/Skeleton';

const CALENDAR_WEEKS = 5;

/** Local YYYY-MM-DD key (matches calendarIntensity's day keys). */
function localDateKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Leitner box colours are semantic (box 1 = weakest → box 5 = mastered) and
// theme-independent, like the CEFR palette — kept as literals.
const BOX_COLORS = ['#D66A6A', '#F4A261', '#E9C46A', '#7EC8A0', '#4CAF9A'];
const BOX_LABELS = ['1 day', '3 days', '7 days', '14 days', '30 days'];

export interface StatsScreenProps {
  onBack: () => void;
  onStartReview: () => void;
}

export function StatsScreen({ onBack, onStartReview }: StatsScreenProps) {
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [stats, setStats] = useState<SrsStats | null>(null);
  // Contribution-calendar intensities, derived from real saved-word activity
  // (SavedWordEntry.created_at) — the only per-day signal the API exposes.
  const [calendar, setCalendar] = useState<Array<0 | 1 | 2 | 3>>([]);
  const [loading, setLoading] = useState(true);
  const isPremium = useIsPremium();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, saved] = await Promise.all([
        srsApi.stats(),
        wordwiseApi.getSavedWords().catch(() => []),
      ]);
      setStats(s);
      const countsByDate: Record<string, number> = {};
      for (const w of saved) {
        const key = localDateKey(w.created_at);
        if (key) countsByDate[key] = (countsByDate[key] ?? 0) + 1;
      }
      setCalendar(calendarIntensity(countsByDate, new Date(), CALENDAR_WEEKS));
    } catch {
      // silent — screen just stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    // Skeleton that mirrors the dashboard's shape (hero stat row + cards) so
    // the screen reads as "almost there" rather than a dead spinner (F-015).
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={onBack} styles={styles} />
        <View style={styles.scrollContent}>
          <View style={styles.heroRow}>
            <Skeleton height={96} radius={14} sheen style={{ flex: 1 }} />
            <Skeleton height={96} radius={14} sheen style={{ flex: 1 }} delay={80} />
          </View>
          <Skeleton height={150} radius={14} sheen delay={120} />
          <Skeleton height={190} radius={14} sheen delay={180} />
        </View>
      </SafeAreaView>
    );
  }

  if (!stats || stats.total_saved === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={onBack} styles={styles} />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No words saved yet</Text>
          <Text style={styles.emptyBody}>
            Save words from movies to start tracking your progress here.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const boxEntries = Object.entries(stats.by_box)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const maxBox = Math.max(...boxEntries.map(([, v]) => v), 1);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={onBack} styles={styles} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Streak + Retention hero */}
        <View style={styles.heroRow}>
          <StatCard
            value={`${stats.current_streak}`}
            label="Day streak"
            sub={`Best: ${stats.longest_streak}`}
            color={tc.primaryOnSurface}
            styles={styles}
          />
          <StatCard
            value={`${stats.retention_pct}%`}
            label="Retention"
            sub={`${stats.total_correct}/${stats.total_reviews}`}
            color={tc.success}
            styles={styles}
          />
        </View>

        {/* Due overview */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Words due</Text>
          <View style={styles.dueRow}>
            <View style={styles.dueItem}>
              <Text style={styles.dueCount}>{stats.due_now}</Text>
              <Text style={styles.dueLabel}>Right now</Text>
            </View>
            <View style={styles.dueDivider} />
            <View style={styles.dueItem}>
              <Text style={styles.dueCount}>{stats.due_today}</Text>
              <Text style={styles.dueLabel}>Today</Text>
            </View>
            <View style={styles.dueDivider} />
            <View style={styles.dueItem}>
              <Text style={styles.dueCount}>{stats.total_saved}</Text>
              <Text style={styles.dueLabel}>Total saved</Text>
            </View>
          </View>
          {stats.due_now > 0 && (
            <TouchableOpacity style={styles.reviewBtn} onPress={onStartReview}>
              <Text style={styles.reviewBtnText}>
                Review {stats.due_now} word{stats.due_now === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Box distribution */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Box progression</Text>
          <Text style={styles.cardSub}>
            Words advance to higher boxes as you remember them
          </Text>
          {boxEntries.map(([box, count]) => (
            <View key={box} style={styles.barRow}>
              <Text style={styles.barLabel}>Box {box}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max((count / maxBox) * 100, 2)}%`,
                      backgroundColor: BOX_COLORS[(box - 1) % BOX_COLORS.length],
                    },
                  ]}
                />
              </View>
              <Text style={styles.barCount}>{count}</Text>
              <Text style={styles.barInterval}>{BOX_LABELS[(box - 1) % BOX_LABELS.length]}</Text>
            </View>
          ))}
        </View>

        {/* Activity — contribution calendar of words saved per day */}
        {calendar.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Activity</Text>
            <Text style={styles.cardSub}>Words saved over the last {CALENDAR_WEEKS} weeks</Text>
            <ContributionCalendar grid={calendar} weeks={CALENDAR_WEEKS} />
          </View>
        ) : null}

        {/* Legend */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How it works</Text>
          <Text style={styles.legendText}>
            New words start in Box 1 (reviewed daily). Each time you remember a
            word, it advances to the next box with a longer interval. Forgetting
            sends it back to Box 1. Words in Box 5 are reviewed once a month —
            they're in your long-term memory.
          </Text>
        </View>

        {/* Export (premium) */}
        {isPremium && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Export your words</Text>
            <Text style={styles.cardSub}>
              Download your saved words for use in Anki or other apps
            </Text>
            <View style={styles.exportRow}>
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={() => Linking.openURL(premiumApi.exportCsvUrl())}
              >
                <Text style={styles.exportBtnText}>CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.exportBtn}
                onPress={() => Linking.openURL(premiumApi.exportAnkiUrl())}
              >
                <Text style={styles.exportBtnText}>Anki</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Header({ onBack, styles }: { onBack: () => void; styles: Styles }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={8}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>My Progress</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

function StatCard({
  value,
  label,
  sub,
  color,
  styles,
}: {
  value: string;
  label: string;
  sub: string;
  color: string;
  styles: Styles;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: tc.paper,
    borderBottomWidth: 1,
    borderBottomColor: tc.border,
  },
  backText: { fontSize: 16, color: tc.primaryOnSurface, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: tc.text },
  scrollContent: { padding: 16, gap: 16, paddingBottom: 32 },
  heroRow: { flexDirection: 'row', gap: 12 },
  statCard: {
    flex: 1,
    backgroundColor: tc.paper,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: tc.border,
  },
  statValue: { fontSize: 36, fontWeight: '800' },
  statLabel: { fontSize: 14, fontWeight: '600', color: tc.text, marginTop: 4 },
  statSub: { fontSize: 12, color: tc.textFaint, marginTop: 2 },
  card: {
    backgroundColor: tc.paper,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: tc.border,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: tc.text, marginBottom: 4 },
  cardSub: { fontSize: 13, color: tc.textSecondary, marginBottom: 16 },
  dueRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  dueItem: { flex: 1, alignItems: 'center' },
  dueDivider: { width: 1, height: 32, backgroundColor: tc.border },
  dueCount: { fontSize: 28, fontWeight: '800', color: tc.text },
  dueLabel: { fontSize: 12, color: tc.textSecondary, marginTop: 2 },
  reviewBtn: {
    backgroundColor: tc.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  reviewBtnText: { color: tc.textInverse, fontSize: 15, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  barLabel: { width: 46, fontSize: 13, color: tc.textSecondary, fontWeight: '600' },
  barTrack: {
    flex: 1,
    height: 18,
    backgroundColor: tc.divider,
    borderRadius: 9,
    overflow: 'hidden',
  },
  barFill: { height: 18, borderRadius: 9 },
  barCount: { width: 28, fontSize: 13, fontWeight: '700', color: tc.text, textAlign: 'right' },
  barInterval: { width: 48, fontSize: 11, color: tc.textFaint },
  legendText: { fontSize: 13, color: tc.textSecondary, lineHeight: 20 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: tc.text, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: tc.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  exportRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  exportBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: tc.primary,
  },
  exportBtnText: { color: tc.textInverse, fontSize: 14, fontWeight: '700' },
});

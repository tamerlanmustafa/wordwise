import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { BACK_ARROW } from '../i18n/rtl';
import { achievementsApi, type Achievement, type AchievementsResponse } from '../services/api';
import { LockIcon, MedalIcon } from './ui/icons';

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  success: '#4CAF9A',
  gold: '#FFD700',
};

const CATEGORY_LABELS: Record<string, string> = {
  vocabulary: 'Vocabulary',
  review: 'Reviews',
  streak: 'Streaks',
  exploration: 'Exploration',
  mastery: 'Mastery',
};

export interface AchievementsScreenProps {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
}

export function AchievementsScreen({ onBack, backLabel }: AchievementsScreenProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<AchievementsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await achievementsApi.triggerCheck();
      const resp = await achievementsApi.getMyAchievements();
      setData(resp);
    } catch (e) {
      console.warn('[Achievements] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = (data?.achievements || []).reduce<Record<string, Achievement[]>>((acc, a) => {
    (acc[a.category] = acc[a.category] || []).push(a);
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>{BACK_ARROW} {backLabel ?? t('action.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('stats:achievements')}</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <Text style={styles.summaryCount}>{data?.total_unlocked || 0}</Text>
            <Text style={styles.summaryLabel}>of {data?.total_available || 0} unlocked</Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, {
                width: `${data ? (data.total_unlocked / data.total_available) * 100 : 0}%`,
              }]} />
            </View>
          </View>

          {Object.entries(grouped).map(([category, achievements]) => (
            <View key={category} style={styles.categorySection}>
              <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category] || category}</Text>
              {achievements.map((a) => (
                <View key={a.key} style={[styles.achievementRow, a.unlocked && styles.achievementUnlocked]}>
                  {/* Drawn, not typed. This was `a.icon || '🏅'` for an
                      unlocked badge and 🔒 for a locked one — a server-supplied
                      emoji string with an emoji fallback, so the row's look
                      depended on the OS font and on whatever the API sent. */}
                  <View style={[styles.achievementIcon, !a.unlocked && styles.achievementIconLocked]}>
                    {a.unlocked ? <MedalIcon size={26} /> : <LockIcon size={24} />}
                  </View>
                  <View style={styles.achievementInfo}>
                    <Text style={[styles.achievementTitle, !a.unlocked && styles.textLocked]}>{a.title}</Text>
                    <Text style={styles.achievementDesc}>{a.description}</Text>
                    {!a.unlocked && (
                      <View style={styles.miniProgress}>
                        <View style={[styles.miniProgressFill, {
                          width: `${Math.min(100, (a.progress / a.threshold) * 100)}%`,
                        }]} />
                      </View>
                    )}
                    {!a.unlocked && (
                      <Text style={styles.progressText}>{a.progress} / {a.threshold}</Text>
                    )}
                  </View>
                  {a.unlocked && <Text style={styles.checkmark}>✓</Text>}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
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
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  summary: { alignItems: 'center', marginBottom: 24, padding: 20, backgroundColor: COLORS.paper, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },
  summaryCount: { fontSize: 48, fontWeight: '800', color: COLORS.primary },
  summaryLabel: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  progressBarBg: { width: '100%', height: 8, backgroundColor: COLORS.border, borderRadius: 4, marginTop: 16 },
  progressBarFill: { height: 8, backgroundColor: COLORS.gold, borderRadius: 4 },
  categorySection: { marginBottom: 20 },
  categoryTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  achievementRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    backgroundColor: COLORS.paper, borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  achievementUnlocked: { borderColor: COLORS.gold, borderWidth: 1.5 },
  achievementIcon: { marginEnd: 14 },
  achievementIconLocked: { opacity: 0.4 },
  achievementInfo: { flex: 1 },
  achievementTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  textLocked: { color: COLORS.textTertiary },
  achievementDesc: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  miniProgress: { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginTop: 6, width: '100%' },
  miniProgressFill: { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  progressText: { fontSize: 11, color: COLORS.textTertiary, marginTop: 3 },
  checkmark: { fontSize: 20, color: COLORS.success, fontWeight: '700' },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  adminApi,
  reportsApi,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  type AdminStats,
  type ReportStats,
  type ReportStatus,
  type WordReport,
} from '../services/api';

// Mobile port of frontend/src/pages/AdminReportsPage.tsx with the
// extra platform stats panel the user asked for at the top.
//
// Sections:
//   1. Stats grid: movies processed, total users, queue progress
//   2. Filter chips for report status (All, Pending, Reviewed, ...)
//   3. Scrollable list of reports with quick actions and a details modal

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  success: '#4CAF9A',
  warning: '#F4A261',
  error: '#D66A6A',
  info: '#4A90E2',
  overlay: 'rgba(0, 0, 0, 0.45)',
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  PENDING: COLORS.warning,
  REVIEWED: COLORS.info,
  RESOLVED: COLORS.success,
  DISMISSED: COLORS.textTertiary,
};

const STATUS_TABS: Array<ReportStatus | 'ALL'> = [
  'ALL',
  'PENDING',
  'REVIEWED',
  'RESOLVED',
  'DISMISSED',
];

// Difficulty buckets (Prisma `difficultylevel` enum). Ordered easiest → hardest
// so the grid reads left-to-right the way a learner thinks about progression.
const LEVEL_ORDER = [
  'BEGINNER',
  'ELEMENTARY',
  'INTERMEDIATE',
  'UPPER_INTERMEDIATE',
  'ADVANCED',
  'PROFICIENT',
] as const;

const LEVEL_LABELS: Record<string, string> = {
  BEGINNER: 'Beginner',
  ELEMENTARY: 'Elementary',
  INTERMEDIATE: 'Intermediate',
  UPPER_INTERMEDIATE: 'Upper int.',
  ADVANCED: 'Advanced',
  PROFICIENT: 'Proficient',
};

const LEVEL_COLORS: Record<string, string> = {
  BEGINNER: '#4CAF50',
  ELEMENTARY: '#8BC34A',
  INTERMEDIATE: '#FFC107',
  UPPER_INTERMEDIATE: '#FF9800',
  ADVANCED: '#F44336',
  PROFICIENT: '#9C27B0',
};

export interface AdminScreenProps {
  onBack: () => void;
}

export function AdminScreen({ onBack }: AdminScreenProps) {
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [reportStats, setReportStats] = useState<ReportStats | null>(null);
  const [reports, setReports] = useState<WordReport[]>([]);
  const [activeTab, setActiveTab] = useState<ReportStatus | 'ALL'>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Details modal state
  const [selected, setSelected] = useState<WordReport | null>(null);
  const [detailsStatus, setDetailsStatus] = useState<ReportStatus>('REVIEWED');
  const [detailsNotes, setDetailsNotes] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);

  const fetchAll = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const statusFilter = activeTab === 'ALL' ? undefined : activeTab;
        const [admin, rs, list] = await Promise.all([
          adminApi.stats().catch((e) => {
            console.warn('[AdminScreen] adminApi.stats failed:', e?.message);
            setError(`Stats: ${e?.message || 'failed'}`);
            return null;
          }),
          reportsApi.stats().catch((e) => {
            console.warn('[AdminScreen] reportsApi.stats failed:', e?.message);
            return null;
          }),
          reportsApi.listAdmin(statusFilter).catch((e) => {
            console.warn('[AdminScreen] reportsApi.listAdmin failed:', e?.message);
            return [];
          }),
        ]);
        setAdminStats(admin);
        setReportStats(rs);
        setReports(list);
      } catch (e: any) {
        setError(e?.message || 'Failed to load admin data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeTab]
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll(false);
  }, [fetchAll]);

  const openDetails = (report: WordReport) => {
    setSelected(report);
    setDetailsStatus(report.status === 'PENDING' ? 'REVIEWED' : report.status);
    setDetailsNotes(report.review_notes || '');
  };

  const closeDetails = () => {
    if (detailsSaving) return;
    setSelected(null);
    setDetailsNotes('');
  };

  const handleSaveDetails = async () => {
    if (!selected) return;
    setDetailsSaving(true);
    try {
      await reportsApi.update(selected.id, {
        status: detailsStatus,
        review_notes: detailsNotes || undefined,
      });
      setSelected(null);
      setDetailsNotes('');
      fetchAll(false);
    } catch (e: any) {
      setError(e?.message || 'Failed to update report');
    } finally {
      setDetailsSaving(false);
    }
  };

  const tabCounts = useMemo(
    () => ({
      ALL: reportStats?.total ?? 0,
      PENDING: reportStats?.pending ?? 0,
      REVIEWED: reportStats?.reviewed ?? 0,
      RESOLVED: reportStats?.resolved ?? 0,
      DISMISSED: reportStats?.dismissed ?? 0,
    }),
    [reportStats]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
        <TouchableOpacity onPress={() => fetchAll()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.refreshText}>↻</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorBannerClose}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Platform stats */}
        <Text style={styles.sectionLabel}>Platform</Text>
        <View style={styles.statsGrid}>
          <StatCard
            label="Movies processed"
            value={adminStats ? `${adminStats.movies_processed}` : '—'}
            sublabel={adminStats ? `of ${adminStats.movies_total} total` : undefined}
            color={COLORS.primary}
          />
          <StatCard
            label="Users"
            value={adminStats ? `${adminStats.users_total}` : '—'}
            color={COLORS.info}
          />
        </View>

        {/* By difficulty level */}
        {adminStats?.movies_by_level && Object.keys(adminStats.movies_by_level).length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Movies by difficulty</Text>
            <View style={styles.statsGrid}>
              {LEVEL_ORDER.filter((lv) => (adminStats.movies_by_level[lv] ?? 0) > 0).map((lv) => (
                <StatCard
                  key={lv}
                  label={LEVEL_LABELS[lv]}
                  value={`${adminStats.movies_by_level[lv] ?? 0}`}
                  color={LEVEL_COLORS[lv]}
                />
              ))}
            </View>
          </>
        )}

        {/* Worker queue */}
        {adminStats?.queue?.done != null && (
          <>
            <Text style={styles.sectionLabel}>Worker queue</Text>
            <View style={styles.statsGrid}>
              <StatCard label="Done" value={`${adminStats.queue.done ?? 0}`} color={COLORS.success} />
              <StatCard label="Pending" value={`${adminStats.queue.pending ?? 0}`} color={COLORS.warning} />
              <StatCard label="Running" value={`${adminStats.queue.running ?? 0}`} color={COLORS.info} />
              <StatCard label="Dead" value={`${adminStats.queue.dead ?? 0}`} color={COLORS.error} />
            </View>
          </>
        )}

        {/* Reports */}
        <View style={styles.reportsHeader}>
          <Text style={styles.sectionLabel}>Reports</Text>
          {reportStats ? (
            <Text style={styles.reportsHeaderCount}>{reportStats.total} total</Text>
          ) : null}
        </View>

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
        >
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab === 'ALL' ? 'All' : REPORT_STATUS_LABELS[tab]} ({tabCounts[tab]})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Reports list */}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No reports in this view</Text>
          </View>
        ) : (
          reports.map((report) => (
            <View key={report.id} style={styles.reportCard}>
              <View style={styles.reportTopRow}>
                <Text style={styles.reportWord}>{report.word}</Text>
                <View style={[styles.statusChip, { backgroundColor: STATUS_COLOR[report.status] }]}>
                  <Text style={styles.statusChipText}>{REPORT_STATUS_LABELS[report.status]}</Text>
                </View>
              </View>
              <Text style={styles.reportMeta} numberOfLines={1}>
                {report.movie_title || 'No movie'} · {REPORT_REASON_LABELS[report.reason]}
              </Text>
              {report.details ? (
                <Text style={styles.reportDetails} numberOfLines={2}>
                  "{report.details}"
                </Text>
              ) : null}
              <Text style={styles.reportFooter}>
                {report.reporter_email || `user #${report.reporter_id}`} ·{' '}
                {new Date(report.created_at).toLocaleDateString()}
              </Text>

              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                  onPress={() => openDetails(report)}
                >
                  <Text style={styles.actionBtnGhostText}>Details</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Details modal */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={closeDetails}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Report details</Text>
              <TouchableOpacity onPress={closeDetails} disabled={detailsSaving}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {selected && (
              <ScrollView style={styles.modalBody}>
                <DetailRow label="Word" value={selected.word} bold />
                <DetailRow label="Movie" value={selected.movie_title || 'N/A'} />
                <DetailRow label="Reason" value={REPORT_REASON_LABELS[selected.reason]} />
                <DetailRow
                  label="Translation source"
                  value={selected.translation_source || 'N/A'}
                />
                {selected.details ? (
                  <DetailRow label="Reporter's details" value={selected.details} />
                ) : null}
                <DetailRow
                  label="Reported by"
                  value={selected.reporter_email || `user #${selected.reporter_id}`}
                />
                <DetailRow label="Reported at" value={new Date(selected.created_at).toLocaleString()} />

                <Text style={styles.modalFieldLabel}>Status</Text>
                <View style={styles.statusButtons}>
                  {(['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'] as ReportStatus[]).map((s) => {
                    const active = detailsStatus === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[
                          styles.statusButton,
                          active && { backgroundColor: STATUS_COLOR[s], borderColor: STATUS_COLOR[s] },
                        ]}
                        onPress={() => setDetailsStatus(s)}
                      >
                        <Text
                          style={[
                            styles.statusButtonText,
                            active && styles.statusButtonTextActive,
                          ]}
                        >
                          {REPORT_STATUS_LABELS[s]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalFieldLabel}>Review notes</Text>
                <TextInput
                  style={styles.notesInput}
                  multiline
                  value={detailsNotes}
                  onChangeText={setDetailsNotes}
                  placeholder="Add notes about this report..."
                  placeholderTextColor="#A0A4B0"
                  editable={!detailsSaving}
                />
              </ScrollView>
            )}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnGhost, { flex: 1 }]}
                onPress={closeDetails}
                disabled={detailsSaving}
              >
                <Text style={styles.actionBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: COLORS.primary, flex: 1 }]}
                onPress={handleSaveDetails}
                disabled={detailsSaving}
              >
                {detailsSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  color: string;
}) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sublabel ? <Text style={styles.statSublabel}>{sublabel}</Text> : null}
    </View>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, bold && { fontWeight: '700', fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    minWidth: 60,
  },
  backText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  refreshText: {
    fontSize: 22,
    color: COLORS.primary,
    minWidth: 60,
    textAlign: 'right',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCE8E8',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorBannerText: {
    flex: 1,
    color: COLORS.error,
    fontSize: 13,
  },
  errorBannerClose: {
    color: COLORS.error,
    fontSize: 16,
    paddingHorizontal: 4,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 10,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 140,
    backgroundColor: COLORS.paper,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statSublabel: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  reportsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  reportsHeaderCount: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 20,
  },
  tabRow: {
    paddingVertical: 6,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: 14,
  },
  reportCard: {
    backgroundColor: COLORS.paper,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  reportTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportWord: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusChipText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  reportMeta: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  reportDetails: {
    marginTop: 6,
    fontSize: 13,
    fontStyle: 'italic',
    color: COLORS.text,
  },
  reportFooter: {
    marginTop: 6,
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  reportActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnGhostText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: COLORS.paper,
    borderRadius: 16,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  modalClose: {
    fontSize: 20,
    color: COLORS.textSecondary,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  detailLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: COLORS.text,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 8,
  },
  statusButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  statusButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.paper,
  },
  statusButtonText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  statusButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  notesInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: COLORS.background,
    marginBottom: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});

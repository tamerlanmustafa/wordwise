import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  adminApi,
  reportsApi,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  type AdminStats,
  type ClientIpReport,
  type DeadJob,
  type EventLoopReport,
  type ProcessedMovie,
  type ReportStats,
  type LatencyReport,
  type ReportStatus,
  type VocabCoverageReport,
  type WordReport,
  type ProcessedSort,
} from '../services/api';
import {
  useEntitlementsStore,
  type AdminViewMode,
} from '../stores/entitlementsStore';
import type { Entitlements } from '../types';
import { CEFR_LEVELS } from '../types/constants';
import { cefrColors } from '../theme/palette';
import {
  STATUS_LABEL as COVERAGE_STATUS_LABEL,
  type AdminColors,
  useAdminColors,
  useStatusTokens,
} from './admin/adminTheme';
import { ClientIpView } from './admin/ClientIpView';
import { EventLoopView } from './admin/EventLoopView';
import { LatencyView } from './admin/LatencyView';
import { VocabCoverageView } from './admin/VocabCoverageView';
import { getFormattingLocale } from '../i18n';
import { alignEnd } from '../i18n/rtl';
import { StarIcon } from './ui/icons';
import { BarChart, DonutChart, type ChartSlice } from './admin/LevelCharts';
import { ScreenHeader } from './common/ScreenHeader';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

// Mobile port of frontend/src/pages/AdminReportsPage.tsx with the
// extra platform stats panel the user asked for at the top.
//
// Sections:
//   1. Stats grid: movies processed, total users, queue progress
//   2. Filter chips for report status (All, Pending, Reviewed, ...)
//   3. Scrollable list of reports with quick actions and a details modal

// A function of the palette rather than a module constant: the palette now
// follows the theme, so a frozen map here would keep painting light-mode
// status chips onto a dark screen.
/**
 * The browser's sort tabs, each with the plain-English reason you'd pick it.
 * `processed` leads because it is the default and the question the screen
 * usually answers: did the job I just started actually land?
 */
const PROCESSED_SORT_TABS: ReadonlyArray<{ id: ProcessedSort; label: string; blurb: string }> = [
  { id: 'processed', label: 'Newest', blurb: 'Most recently processed first — what the workers just finished.' },
  { id: 'votes',     label: 'Popular', blurb: 'Most-rated on TMDB first — the films the most people have seen.' },
  { id: 'rating',    label: 'Best',    blurb: 'Highest TMDB score first.' },
  { id: 'level',     label: 'Hardest', blurb: 'Hardest vocabulary first, by difficulty score.' },
  { id: 'year',      label: 'Latest',  blurb: 'Newest release year first.' },
  { id: 'title',     label: 'A–Z',     blurb: 'Alphabetical by title.' },
];

/**
 * When a script was processed, as a real date plus how long ago.
 *
 * Both halves, because they answer different questions and the list is sorted
 * by this column: "2 Sep" is what you match against a deploy or an incident,
 * "yesterday" is what you scan for when you just want to know whether the
 * batch you kicked off has landed. A relative age alone loses the day, which
 * is exactly what you need when correlating with anything else.
 *
 * The year is only printed when it is not the current one — the catalogue runs
 * from April, so on this screen almost every row would otherwise repeat 2026.
 */
function processedOn(iso: string): string {
  const then = new Date(iso);
  const ms = Date.now() - then.getTime();
  if (!Number.isFinite(ms) || Number.isNaN(then.getTime())) return '';

  const locale = getFormattingLocale();
  const sameYear = then.getFullYear() === new Date().getFullYear();
  const date = then.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });

  const days = Math.floor(ms / 86_400_000);
  let ago: string;
  if (days <= 0) ago = 'today';
  else if (days === 1) ago = 'yesterday';
  else if (days < 30) ago = `${days}d ago`;
  else {
    const months = Math.floor(days / 30);
    ago = months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
  }
  return `${date} · ${ago}`;
}

const statusColors = (c: AdminColors): Record<ReportStatus, string> => ({
  PENDING: c.warning,
  REVIEWED: c.info,
  RESOLVED: c.success,
  DISMISSED: c.textTertiary,
});

const STATUS_TABS: Array<ReportStatus | 'ALL'> = [
  'ALL',
  'PENDING',
  'REVIEWED',
  'RESOLVED',
  'DISMISSED',
];

// Difficulty buckets. These were the six long `difficultylevel` enum names
// until #103 retired that column — the backend now reports CEFR codes, banded
// off `difficulty_score` the same way every learner-facing screen does, so the
// admin counts can no longer disagree with the shelves. `CEFR_LEVELS` is
// already ordered easiest → hardest, which is how the grid should read, and
// `cefrColors` already carries these exact six colours.
const LEVEL_ORDER = CEFR_LEVELS;

export interface AdminScreenProps {
  onBack: () => void;
  /** Names where Back lands (e.g. "Profile"). Defaults to a plain "Back". */
  backLabel?: string;
}

type AdminView =
  | 'main'
  | 'dead'
  | 'processed'
  | 'coverage'
  | 'latency'
  | 'eventLoop'
  | 'clientIp';

export function AdminScreen({ onBack, backLabel }: AdminScreenProps) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const STATUS_COLOR = useMemo(() => statusColors(c), [c]);

  // The tab bar is an absolute overlay, so every scroller reserves its height
  // itself or its last rows sit behind the floating capsule.
  const barInset = useBottomBarInset();
  const [view, setView] = useState<AdminView>('main');
  const [deadJobs, setDeadJobs] = useState<DeadJob[] | null>(null);
  const [deadLoading, setDeadLoading] = useState(false);
  const [coverage, setCoverage] = useState<VocabCoverageReport | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [latencyLoading, setLatencyLoading] = useState(false);
  const [eventLoop, setEventLoop] = useState<EventLoopReport | null>(null);
  const [eventLoopLoading, setEventLoopLoading] = useState(false);
  const [clientIp, setClientIp] = useState<ClientIpReport | null>(null);
  const [clientIpLoading, setClientIpLoading] = useState(false);
  const [processedMovies, setProcessedMovies] = useState<ProcessedMovie[] | null>(null);
  const [processedLoading, setProcessedLoading] = useState(false);
  const [processedFilter, setProcessedFilter] = useState<string | null>(null);
  const [processedSort, setProcessedSort] = useState<ProcessedSort>('processed');
  const [processedHasMore, setProcessedHasMore] = useState(false);
  const [processedPaging, setProcessedPaging] = useState(false);
  // Mirrors the list length for the append guard: `processedMovies` is state
  // and a rapid second onEndReached would read the pre-commit value.
  const processedCountRef = useRef(0);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  // Chart inputs. Built here rather than inside the chart so the donut and the
  // tappable tiles below it read the same numbers off the same object.
  const movieSlices = useMemo<ChartSlice[]>(
    () =>
      LEVEL_ORDER.map((lv) => ({
        label: lv,
        value: adminStats?.movies_by_level?.[lv] ?? 0,
        color: cefrColors[lv],
      })),
    [adminStats],
  );
  const wordSlices = useMemo<ChartSlice[]>(
    () => [
      ...LEVEL_ORDER.map((lv) => ({
        label: lv,
        value: adminStats?.words_by_level?.[lv] ?? 0,
        color: cefrColors[lv],
      })),
      // Not a CEFR band, so it gets the neutral ink rather than a colour that
      // would imply it sits on the difficulty ramp.
      { label: 'UNKNOWN', value: adminStats?.words_by_level?.UNKNOWN ?? 0, color: c.textTertiary },
    ],
    [adminStats, c.textTertiary],
  );
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

  // Admin tier preview toggle (see docs/MONETIZATION_PLAN.md §6).
  const adminViewMode = useEntitlementsStore((s) => s.adminViewMode);
  const setAdminViewMode = useEntitlementsStore((s) => s.setAdminViewMode);

  // Grant/revoke Plus UI state.
  const [grantQuery, setGrantQuery] = useState('');
  const [grantResults, setGrantResults] = useState<
    Array<{ id: number; email: string; username: string; is_admin: boolean; entitlements: Entitlements }>
  >([]);
  const [grantSearching, setGrantSearching] = useState(false);
  const [grantBusy, setGrantBusy] = useState<number | null>(null);

  const searchUsers = useCallback(async (q: string) => {
    setGrantQuery(q);
    if (q.trim().length < 2) {
      setGrantResults([]);
      return;
    }
    setGrantSearching(true);
    try {
      const users = await adminApi.searchUsers(q.trim());
      setGrantResults(users);
    } catch (e: any) {
      console.warn('[AdminScreen] user search failed:', e?.message);
    } finally {
      setGrantSearching(false);
    }
  }, []);

  const handleGrant = useCallback(
    async (userId: number, tier: 'comped' | 'trial') => {
      setGrantBusy(userId);
      try {
        const updated = await adminApi.grantPremium({
          user_id: userId,
          tier,
          expires_in_days: tier === 'trial' ? 7 : undefined,
        });
        setGrantResults((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, entitlements: updated.entitlements } : u))
        );
      } catch (e: any) {
        Alert.alert('Grant failed', e?.message || 'Unknown error');
      } finally {
        setGrantBusy(null);
      }
    },
    []
  );

  const handleRevoke = useCallback(async (userId: number) => {
    setGrantBusy(userId);
    try {
      const updated = await adminApi.revokePremium(userId);
      setGrantResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, entitlements: updated.entitlements } : u))
      );
    } catch (e: any) {
      Alert.alert('Revoke failed', e?.message || 'Unknown error');
    } finally {
      setGrantBusy(null);
    }
  }, []);

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

  const openDeadJobs = useCallback(async () => {
    setView('dead');
    if (deadJobs !== null) return; // already fetched
    setDeadLoading(true);
    try {
      const jobs = await adminApi.deadJobs();
      setDeadJobs(jobs);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dead jobs');
      setDeadJobs([]);
    } finally {
      setDeadLoading(false);
    }
  }, [deadJobs]);

  /** Page 0 for a given level+sort. Every filter change comes through here. */
  const loadProcessed = useCallback(
    async (level: string | null, sort: ProcessedSort) => {
      setProcessedMovies(null);
      processedCountRef.current = 0;
      setProcessedLoading(true);
      try {
        const page = await adminApi.processedMovies({
          level: level ?? undefined,
          sort,
        });
        setProcessedMovies(page.movies);
        processedCountRef.current = page.movies.length;
        setProcessedHasMore(page.has_more);
      } catch (e: any) {
        setError(e?.message || 'Failed to load processed movies');
        setProcessedMovies([]);
        setProcessedHasMore(false);
      } finally {
        setProcessedLoading(false);
      }
    },
    [],
  );

  const openProcessed = useCallback(
    async (level?: string) => {
      setView('processed');
      setProcessedFilter(level ?? null);
      setProcessedSort('processed');
      await loadProcessed(level ?? null, 'processed');
    },
    [loadProcessed],
  );

  const refreshProcessed = useCallback(
    () => loadProcessed(processedFilter, processedSort),
    [loadProcessed, processedFilter, processedSort],
  );

  /** Appends the next page. The offset is the list we already hold, read from
   *  a ref so two quick end-reaches cannot both request the same page. */
  const loadMoreProcessed = useCallback(async () => {
    if (processedPaging || processedLoading || !processedHasMore) return;
    setProcessedPaging(true);
    const offset = processedCountRef.current;
    try {
      const page = await adminApi.processedMovies({
        level: processedFilter ?? undefined,
        sort: processedSort,
        offset,
      });
      // A filter change while this was in flight makes the page stale.
      if (processedCountRef.current !== offset) return;
      setProcessedMovies((prev) => [...(prev ?? []), ...page.movies]);
      processedCountRef.current = offset + page.movies.length;
      setProcessedHasMore(page.has_more);
    } catch (e: any) {
      setError(e?.message || 'Failed to load more movies');
    } finally {
      setProcessedPaging(false);
    }
  }, [processedPaging, processedLoading, processedHasMore, processedFilter, processedSort]);

  const changeProcessedSort = useCallback(
    (sort: ProcessedSort) => {
      setProcessedSort(sort);
      void loadProcessed(processedFilter, sort);
    },
    [loadProcessed, processedFilter],
  );

  const changeProcessedLevel = useCallback(
    (level: string | null) => {
      setProcessedFilter(level);
      void loadProcessed(level, processedSort);
    },
    [loadProcessed, processedSort],
  );

  const refreshDeadJobs = useCallback(async () => {
    setDeadLoading(true);
    try {
      const jobs = await adminApi.deadJobs();
      setDeadJobs(jobs);
    } catch (e: any) {
      setError(e?.message || 'Failed to load dead jobs');
    } finally {
      setDeadLoading(false);
    }
  }, []);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const report = await adminApi.vocabCoverage();
      setCoverage(report);
    } catch (e: any) {
      setError(e?.message || 'Failed to load vocab coverage');
    } finally {
      setCoverageLoading(false);
    }
  }, []);

  const openCoverage = useCallback(() => {
    setView('coverage');
    if (coverage === null) loadCoverage();
  }, [coverage, loadCoverage]);

  const loadLatency = useCallback(async () => {
    setLatencyLoading(true);
    try {
      const report = await adminApi.latency();
      setLatency(report);
    } catch (e: any) {
      setError(e?.message || 'Failed to load API latency');
    } finally {
      setLatencyLoading(false);
    }
  }, []);

  const openLatency = useCallback(() => {
    setView('latency');
    if (latency === null) loadLatency();
  }, [latency, loadLatency]);

  const loadEventLoop = useCallback(async () => {
    setEventLoopLoading(true);
    try {
      const report = await adminApi.eventLoop();
      setEventLoop(report);
    } catch (e: any) {
      setError(e?.message || 'Failed to load event-loop health');
    } finally {
      setEventLoopLoading(false);
    }
  }, []);

  const openEventLoop = useCallback(() => {
    setView('eventLoop');
    if (eventLoop === null) loadEventLoop();
  }, [eventLoop, loadEventLoop]);

  const loadClientIp = useCallback(async () => {
    setClientIpLoading(true);
    try {
      const report = await adminApi.clientIp();
      setClientIp(report);
    } catch (e: any) {
      setError(e?.message || 'Failed to load attempt-limit health');
    } finally {
      setClientIpLoading(false);
    }
  }, []);

  const openClientIp = useCallback(() => {
    setView('clientIp');
    if (clientIp === null) loadClientIp();
  }, [clientIp, loadClientIp]);

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

  if (view === 'processed') {
    const headerLabel = processedFilter
      ? `${processedFilter} movies`
      : 'Processed movies';
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title={headerLabel}
          right={
            <TouchableOpacity onPress={refreshProcessed} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Filters. Level scopes the shelf; sort answers "ordered how".
            Both re-request page 0 rather than re-sorting what is in memory —
            the list is a window onto 4,400 films, not the whole set. */}
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            <TouchableOpacity
              style={[styles.filterChip, processedFilter === null && styles.filterChipOn]}
              onPress={() => changeProcessedLevel(null)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  processedFilter === null && styles.filterChipTextOn,
                ]}
              >
                All levels
              </Text>
            </TouchableOpacity>
            {CEFR_LEVELS.map((lv) => (
              <TouchableOpacity
                key={lv}
                style={[styles.filterChip, processedFilter === lv && styles.filterChipOn]}
                onPress={() => changeProcessedLevel(lv)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    processedFilter === lv && styles.filterChipTextOn,
                  ]}
                >
                  {lv}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {PROCESSED_SORT_TABS.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[styles.sortChip, processedSort === tab.id && styles.sortChipOn]}
                onPress={() => changeProcessedSort(tab.id)}
              >
                <Text
                  style={[
                    styles.sortChipText,
                    processedSort === tab.id && styles.sortChipTextOn,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {processedLoading && processedMovies === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !processedMovies || processedMovies.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No movies</Text>
          </View>
        ) : (
          // FlatList, not a ScrollView of every row: the old screen mapped up
          // to 1,000 cards into memory before the first one appeared.
          <FlatList
            data={processedMovies}
            keyExtractor={(m) => String(m.movie_id)}
            contentContainerStyle={[styles.scroll, { paddingBottom: barInset + 24 }]}
            onEndReached={loadMoreProcessed}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={
              <Text style={styles.deadIntro}>
                {PROCESSED_SORT_TABS.find((t) => t.id === processedSort)?.blurb}
              </Text>
            }
            ListFooterComponent={
              processedPaging ? (
                <View style={styles.pageFooter}>
                  <ActivityIndicator size="small" color={c.primary} />
                </View>
              ) : !processedHasMore ? (
                <Text style={styles.pageFooterText}>
                  End of list — {processedMovies.length} loaded
                </Text>
              ) : null
            }
            renderItem={({ item: m }) => {
              const lvColor = m.difficulty_level ? cefrColors[m.difficulty_level] : c.textTertiary;
              const lvLabel = m.difficulty_level ?? '—';
              return (
                <View style={[styles.deadCard, { borderStartColor: lvColor }]}>
                  <View style={styles.deadTopRow}>
                    <Text style={styles.deadTitle} numberOfLines={2}>
                      {m.title}
                    </Text>
                    {m.year ? <Text style={styles.deadYear}>{m.year}</Text> : null}
                  </View>
                  <View style={styles.processedMetaRow}>
                    <View style={[styles.statusChip, { backgroundColor: lvColor }]}>
                      <Text style={styles.statusChipText}>{lvLabel}</Text>
                    </View>
                    {m.vote_average != null ? (
                      <View style={styles.processedRatingRow}>
                        <StarIcon size={10} filled animate={false} />
                        <Text style={styles.processedMetaText}>{m.vote_average.toFixed(1)}</Text>
                      </View>
                    ) : null}
                    {m.vote_count != null ? (
                      <Text style={styles.processedMetaText}>
                        {m.vote_count.toLocaleString()} votes
                      </Text>
                    ) : null}
                    {m.processed_at ? (
                      <Text style={styles.processedDate}>{processedOn(m.processed_at)}</Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>
    );
  }

  if (view === 'dead') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title={'Dead jobs'}
          right={
            <TouchableOpacity onPress={refreshDeadJobs} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {deadLoading && deadJobs === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !deadJobs || deadJobs.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No dead jobs</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: barInset + 24 }]}>
            <Text style={styles.deadIntro}>
              These {deadJobs.length} movies couldn't be ingested — every script
              source (STANDS4 PDF, STANDS4 API, OpenSubtitles) returned nothing.
              Typically this is foreign-language films, shorts, or TV specials
              with no English subtitles available.
            </Text>
            {deadJobs.map((job) => (
              <View key={job.id} style={styles.deadCard}>
                <View style={styles.deadTopRow}>
                  <Text style={styles.deadTitle} numberOfLines={2}>
                    {job.title}
                  </Text>
                  {job.year ? <Text style={styles.deadYear}>{job.year}</Text> : null}
                </View>
                <Text style={styles.deadMeta}>
                  TMDB #{job.tmdb_id} · {job.attempts} attempt{job.attempts === 1 ? '' : 's'}
                  {job.finished_at
                    ? ` · ${new Date(job.finished_at * 1000).toLocaleDateString()}`
                    : ''}
                </Text>
                {job.last_error ? (
                  <Text style={styles.deadError} numberOfLines={3}>
                    {job.last_error}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  if (view === 'coverage') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title={'Vocab coverage'}
          right={
            <TouchableOpacity onPress={loadCoverage} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {coverageLoading && coverage === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !coverage ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No data</Text>
          </View>
        ) : (
          <VocabCoverageView report={coverage} />
        )}
      </SafeAreaView>
    );
  }

  if (view === 'latency') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title="API latency"
          right={
            <TouchableOpacity onPress={loadLatency} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {latencyLoading && latency === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !latency ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No data</Text>
          </View>
        ) : (
          <LatencyView report={latency} />
        )}
      </SafeAreaView>
    );
  }

  if (view === 'eventLoop') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title="Event loop"
          right={
            <TouchableOpacity onPress={loadEventLoop} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {eventLoopLoading && eventLoop === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !eventLoop ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No data</Text>
          </View>
        ) : (
          <EventLoopView report={eventLoop} />
        )}
      </SafeAreaView>
    );
  }

  if (view === 'clientIp') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          onBack={() => setView('main')}
          backLabel="Admin"
          title="Attempt limits"
          right={
            <TouchableOpacity onPress={loadClientIp} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.refreshText}>↻</Text>
            </TouchableOpacity>
          }
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)}>
              <Text style={styles.errorBannerClose}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {clientIpLoading && clientIp === null ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={c.primary} />
          </View>
        ) : !clientIp ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No data</Text>
          </View>
        ) : (
          <ClientIpView report={clientIp} />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        onBack={onBack}
        backLabel={backLabel}
        title="Admin"
        right={
          <TouchableOpacity onPress={() => fetchAll()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.refreshText}>↻</Text>
          </TouchableOpacity>
        }
      />

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorBannerClose}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: barInset + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Platform stats */}
        <Text style={styles.sectionLabel}>Platform</Text>
        <View style={styles.statsGrid}>
          <StatCard
            label="Movies processed"
            value={adminStats ? `${adminStats.movies_processed}` : '—'}
            sublabel={adminStats ? `of ${adminStats.movies_total} total` : undefined}
            color={c.primary}
            onPress={() => openProcessed()}
          />
          <StatCard
            label="Users"
            value={adminStats ? `${adminStats.users_total}` : '—'}
            color={c.info}
          />
        </View>

        {/* Health surfaces — each opens its own /admin/health/* view. All show
            their overall status once loaded at least once this session.
            Latency and Event loop are a pair: latency says which endpoint is
            slow, the event loop says whether one of them is freezing the rest. */}
        <Text style={styles.sectionLabel}>Health</Text>
        <View style={styles.statsGrid}>
          <StatCard
            label="Vocab coverage"
            value={coverage ? COVERAGE_STATUS_LABEL[coverage.overall_status] : 'View →'}
            sublabel={coverage ? undefined : 'words → sentences → translations'}
            color={coverage ? statusTokens[coverage.overall_status].mark : c.primary}
            onPress={openCoverage}
          />
          <StatCard
            label="API latency"
            value={latency ? COVERAGE_STATUS_LABEL[latency.overall_status] : 'View →'}
            sublabel={latency ? undefined : 'how fast the app’s requests answer'}
            color={latency ? statusTokens[latency.overall_status].mark : c.primary}
            onPress={openLatency}
          />
          <StatCard
            label="Event loop"
            value={eventLoop ? COVERAGE_STATUS_LABEL[eventLoop.overall_status] : 'View →'}
            sublabel={eventLoop ? undefined : 'whether one request freezes the rest'}
            color={eventLoop ? statusTokens[eventLoop.overall_status].mark : c.primary}
            onPress={openEventLoop}
          />
          <StatCard
            label="Attempt limits"
            value={clientIp ? COVERAGE_STATUS_LABEL[clientIp.overall_status] : 'View →'}
            sublabel={clientIp ? undefined : 'whether sign-in caps count per person'}
            color={clientIp ? statusTokens[clientIp.overall_status].mark : c.primary}
            onPress={openClientIp}
          />
        </View>

        {/* Admin tier preview toggle — see docs/MONETIZATION_PLAN.md §6.
            Lets admins simulate free/premium views for QA. Client-side
            override only — does NOT change server-side subscription_tier. */}
        <Text style={styles.sectionLabel}>View mode (QA preview)</Text>
        <View style={styles.viewModeRow}>
          {(['admin', 'premium', 'free'] as AdminViewMode[]).map((mode) => {
            const active = adminViewMode === mode;
            const label =
              mode === 'admin' ? 'Admin' : mode === 'premium' ? 'Premium' : 'Free';
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.viewModeBtn, active && styles.viewModeBtnActive]}
                onPress={() => setAdminViewMode(mode)}
              >
                <Text
                  style={[
                    styles.viewModeBtnText,
                    active && styles.viewModeBtnTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.viewModeHint}>
          {adminViewMode === 'admin'
            ? 'Full admin access. Ads hidden, all Plus features unlocked.'
            : adminViewMode === 'premium'
              ? 'Simulating a premium user. Ads hidden, Plus unlocked, paywalls skipped.'
              : 'Simulating a free user. Ads will show, paywalls will trigger. Admin tools still work.'}
        </Text>

        {/* Grant/Revoke Plus */}
        <Text style={styles.sectionLabel}>Grant Plus</Text>
        <TextInput
          style={styles.grantInput}
          placeholder="Search email or username…"
          placeholderTextColor={c.textTertiary}
          value={grantQuery}
          onChangeText={searchUsers}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {grantSearching && (
          <Text style={styles.grantHint}>Searching…</Text>
        )}
        {grantResults.map((u) => {
          const tier = u.entitlements.tier;
          const isPlus = u.entitlements.is_premium && !u.is_admin;
          return (
            <View key={u.id} style={styles.grantRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.grantRowName}>
                  {u.username} {u.is_admin ? '· admin' : ''}
                </Text>
                <Text style={styles.grantRowEmail} numberOfLines={1}>
                  {u.email} · tier: {tier}
                </Text>
              </View>
              {u.is_admin ? (
                <Text style={styles.grantRowLocked}>admin</Text>
              ) : isPlus ? (
                <TouchableOpacity
                  style={[styles.grantBtn, styles.grantBtnRevoke]}
                  disabled={grantBusy === u.id}
                  onPress={() => handleRevoke(u.id)}
                >
                  <Text style={styles.grantBtnText}>
                    {grantBusy === u.id ? '…' : 'Revoke'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.grantBtn, styles.grantBtnTrial]}
                    disabled={grantBusy === u.id}
                    onPress={() => handleGrant(u.id, 'trial')}
                  >
                    <Text style={styles.grantBtnText}>7d trial</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.grantBtn, styles.grantBtnGrant]}
                    disabled={grantBusy === u.id}
                    onPress={() => handleGrant(u.id, 'comped')}
                  >
                    <Text style={styles.grantBtnText}>
                      {grantBusy === u.id ? '…' : 'Comp'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          );
        })}

        {/* Films by level — donut for the shape, tappable tiles to browse. */}
        {adminStats?.movies_by_level && Object.keys(adminStats.movies_by_level).length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Films by level</Text>
            <Text style={styles.sectionHint}>
              How the graded catalogue splits across the six CEFR bands. Every film sits in
              exactly one, decided by its difficulty score. Tap a band to browse it.
            </Text>
            <View style={styles.chartCard}>
              <DonutChart
                slices={movieSlices}
                total={movieSlices.reduce((n, sl) => n + sl.value, 0)}
                caption="films"
              />
            </View>
            <View style={styles.statsGrid}>
              {LEVEL_ORDER.filter((lv) => (adminStats.movies_by_level[lv] ?? 0) > 0).map((lv) => (
                <StatCard
                  key={lv}
                  label={lv}
                  value={`${adminStats.movies_by_level[lv] ?? 0}`}
                  color={cefrColors[lv]}
                  onPress={() => openProcessed(lv)}
                />
              ))}
            </View>
          </>
        )}

        {/* Words by level — bars, not a donut: UNKNOWN dwarfs the rest, and a
            donut of one huge wedge says less than a ranked comparison. */}
        {adminStats?.words_by_level && Object.keys(adminStats.words_by_level).length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Words by level</Text>
            <Text style={styles.sectionHint}>
              Distinct words in the dictionary, by the band we graded them into. Counted once
              each — a word in 500 films still counts once. UNKNOWN is the pile we could not
              grade; it should be shrinking.
            </Text>
            <View style={styles.chartCard}>
              <BarChart slices={wordSlices} />
            </View>
          </>
        )}

        {/* Worker queue */}
        {adminStats?.queue?.done != null && (
          <>
            <Text style={styles.sectionLabel}>Worker queue</Text>
            <View style={styles.statsGrid}>
              <StatCard label="Done" value={`${adminStats.queue.done ?? 0}`} color={c.success} />
              <StatCard label="Pending" value={`${adminStats.queue.pending ?? 0}`} color={c.warning} />
              <StatCard label="Running" value={`${adminStats.queue.running ?? 0}`} color={c.info} />
              <StatCard
                label="Dead"
                value={`${adminStats.queue.dead ?? 0}`}
                color={c.error}
                onPress={(adminStats.queue.dead ?? 0) > 0 ? openDeadJobs : undefined}
              />
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
            <ActivityIndicator size="large" color={c.primary} />
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
                style={[styles.actionBtn, { backgroundColor: c.primary, flex: 1 }]}
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
  onPress,
}: {
  label: string;
  value: string;
  sublabel?: string;
  color: string;
  onPress?: () => void;
}) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const body = (
    <>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sublabel ? <Text style={styles.statSublabel}>{sublabel}</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.statCard, { borderStartColor: color }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={[styles.statCard, { borderStartColor: color }]}>{body}</View>;
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, bold && { fontWeight: '700', fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  viewModeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  viewModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
  },
  viewModeBtnActive: {
    backgroundColor: c.accentFill,
    borderColor: c.primary,
  },
  viewModeBtnText: {
    fontSize: 14,
    color: c.textSecondary,
    fontWeight: '600',
  },
  // Gold fill takes the deep ink, never white — see `accentInk`.
  viewModeBtnTextActive: {
    color: c.accentInk,
  },
  viewModeHint: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 16,
    lineHeight: 16,
  },
  grantInput: {
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: c.text,
    marginBottom: 8,
  },
  grantHint: {
    fontSize: 12,
    color: c.textTertiary,
    marginBottom: 8,
  },
  grantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    gap: 6,
  },
  grantRowName: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text,
  },
  grantRowEmail: {
    fontSize: 12,
    color: c.textSecondary,
    marginTop: 2,
  },
  grantRowLocked: {
    fontSize: 12,
    color: c.textTertiary,
    fontStyle: 'italic',
  },
  grantBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  grantBtnGrant: { backgroundColor: c.success },
  grantBtnTrial: { backgroundColor: c.info },
  grantBtnRevoke: { backgroundColor: c.error },
  // These three fills are status colours, which darken in light mode and
  // lighten in dark — so the ink on them has to flip with the scheme rather
  // than being a fixed white that fails on half of them.
  grantBtnText: {
    color: c.onStatusFill,
    fontSize: 12,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: c.paper,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backButton: {
    minWidth: 60,
  },
  backText: {
    fontSize: 16,
    color: c.primary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
  },
  refreshText: {
    fontSize: 22,
    color: c.primary,
    minWidth: 60,
    textAlign: alignEnd,
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
    color: c.error,
    fontSize: 13,
  },
  errorBannerClose: {
    color: c.error,
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
    color: c.textSecondary,
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
    backgroundColor: c.paper,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderStartWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '700',
    color: c.text,
  },
  statLabel: {
    fontSize: 12,
    color: c.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statSublabel: {
    fontSize: 11,
    color: c.textTertiary,
    marginTop: 2,
  },
  reportsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  reportsHeaderCount: {
    fontSize: 12,
    color: c.textTertiary,
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
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
  },
  tabActive: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  tabText: {
    fontSize: 12,
    color: c.textSecondary,
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
    color: c.textTertiary,
    fontSize: 14,
  },
  reportCard: {
    backgroundColor: c.paper,
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
    color: c.text,
    flex: 1,
    marginEnd: 8,
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
    color: c.textSecondary,
  },
  reportDetails: {
    marginTop: 6,
    fontSize: 13,
    fontStyle: 'italic',
    color: c.text,
  },
  reportFooter: {
    marginTop: 6,
    fontSize: 11,
    color: c.textTertiary,
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
    borderColor: c.border,
  },
  actionBtnGhostText: {
    color: c.textSecondary,
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
    backgroundColor: c.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: c.paper,
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
    borderBottomColor: c.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
  },
  modalClose: {
    fontSize: 20,
    color: c.textSecondary,
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  detailLabel: {
    fontSize: 11,
    color: c.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: c.text,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textSecondary,
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
    borderColor: c.border,
    backgroundColor: c.paper,
  },
  statusButtonText: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '500',
  },
  statusButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  notesInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: c.text,
    minHeight: 80,
    textAlignVertical: 'top',
    backgroundColor: c.background,
    marginBottom: 16,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  deadIntro: {
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 19,
    marginBottom: 12,
  },
  deadCard: {
    backgroundColor: c.paper,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderStartWidth: 4,
    borderStartColor: c.error,
    borderWidth: 1,
    borderColor: c.border,
  },
  deadTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  deadTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: c.text,
    flex: 1,
  },
  deadYear: {
    fontSize: 13,
    color: c.textTertiary,
    marginTop: 2,
  },
  deadMeta: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 6,
  },
  // The sort column, so it reads as the row's timestamp rather than as one
  // more grey stat next to the vote count.
  processedDate: {
      fontSize: 11.5,
      fontWeight: '600',
      color: c.primary,
    },
    chartCard: {
      backgroundColor: c.paper,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      marginBottom: 12,
    },
    sectionHint: {
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textSecondary,
      marginBottom: 10,
      marginTop: -4,
    },
    filterBar: {
      paddingTop: 10,
      paddingBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: 8,
    },
    filterRow: {
      paddingHorizontal: 16,
      gap: 8,
      alignItems: 'center',
    },
    filterChip: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.paper,
    },
    filterChipOn: {
      backgroundColor: c.accentFill,
      borderColor: c.accentFill,
    },
    filterChipText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: c.textSecondary,
    },
    // Gold-on-gold needs the deep ink, never white — white on gold is ~2:1.
    filterChipTextOn: {
      color: c.accentInk,
    },
    sortChip: {
      paddingHorizontal: 11,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: c.inset,
    },
    sortChipOn: {
      backgroundColor: c.text,
    },
    sortChipText: {
      fontSize: 11.5,
      fontWeight: '700',
      color: c.textSecondary,
    },
    sortChipTextOn: {
      color: c.background,
    },
    pageFooter: {
      paddingVertical: 18,
      alignItems: 'center',
    },
    pageFooterText: {
      paddingVertical: 18,
      textAlign: 'center',
      fontSize: 12,
      color: c.textTertiary,
    },
    processedMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  processedRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  processedMetaText: {
    fontSize: 12,
    color: c.textSecondary,
  },
  deadError: {
    fontSize: 12,
    color: c.error,
    fontFamily: 'Menlo',
    backgroundColor: c.background,
    padding: 8,
    borderRadius: 6,
  },
});

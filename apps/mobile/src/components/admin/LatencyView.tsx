/**
 * LatencyView — the body of the admin API-latency screen (issue #130).
 *
 * Two halves, because they answer different questions:
 * - the headline metrics ("how does the API feel right now") render with the
 *   shared HealthMetricCard, same as every other /admin/health/* report;
 * - the route table ("which endpoint is the problem") is a ranked list of bars,
 *   since the whole point is comparing endpoints against each other.
 *
 * Bars are scaled against the slowest route rather than an absolute axis: the
 * range spans three orders of magnitude, so an absolute scale would flatten
 * everything except the worst row into an invisible sliver.
 *
 * Status is never colour-alone — every row prints its p95 and carries a text
 * chip. Copy and formatting come from `latencyContent`; thresholds come from
 * the server.
 */

import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { LatencyReport, LatencyRoute } from '../../services/api';
import { STATUS_LABEL, STATUS_MEANING, type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { HealthMetricCard } from './HealthMetricCard';
import { statusCounts } from './healthMetricContent';
import {
  ROUTE_SORTS,
  explanationForLatencyMetric,
  formatCount,
  formatMs,
  routeBarPct,
  sortRoutes,
  windowSummary,
  type RouteSortId,
} from './latencyContent';

type TabId = 'overview' | 'endpoints';

export function LatencyView({ report }: { report: LatencyReport }) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [tab, setTab] = useState<TabId>('overview');
  const [sort, setSort] = useState<RouteSortId>('p95');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);

  const counts = useMemo(() => statusCounts(report.metrics), [report.metrics]);
  const sorted = useMemo(() => sortRoutes(report.routes, sort), [report.routes, sort]);
  // Always scale against the true slowest, so the bars keep their meaning when
  // the table is re-sorted by traffic or errors.
  const slowestP95 = useMemo(
    () => report.routes.reduce((max, r) => Math.max(max, r.p95_ms), 0),
    [report.routes]
  );

  const tokens = statusTokens[report.overall_status];
  const activeSort = ROUTE_SORTS.find((s) => s.id === sort) ?? ROUTE_SORTS[0];

  return (
    <View style={styles.flex}>
      <View style={styles.tabBar}>
        <View style={styles.tabRow}>
          {([
            { id: 'overview' as TabId, label: 'Overview' },
            { id: 'endpoints' as TabId, label: `Endpoints (${report.routes.length})` },
          ]).map((t) => {
            const isActive = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setTab(t.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'overview' ? (
          <>
            <View style={styles.hero}>
              <View style={[styles.heroChip, { backgroundColor: tokens.chipBg }]}>
                <Text style={[styles.heroChipText, { color: tokens.chipInk }]}>
                  {STATUS_LABEL[report.overall_status]}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.heroTitle}>API response times</Text>
                <Text style={styles.heroSub}>
                  {counts.fail > 0
                    ? `${counts.fail} of ${report.metrics.length} checks need attention`
                    : counts.warn > 0
                      ? `${counts.warn} of ${report.metrics.length} checks worth watching`
                      : `All ${report.metrics.length} checks healthy`}
                </Text>
              </View>
            </View>

            <Text style={styles.heroExplain}>{windowSummary(report)}</Text>

            {report.metrics.map((m) => (
              <HealthMetricCard
                key={m.key}
                metric={m}
                explanation={explanationForLatencyMetric(m.key)}
                expanded={expandedKey === m.key}
                onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)}
              />
            ))}

            {report.routes.length > 0 ? (
              <TouchableOpacity
                style={[styles.card, styles.jumpRow]}
                onPress={() => setTab('endpoints')}
                activeOpacity={0.7}
              >
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Every endpoint</Text>
                  <Text style={styles.catBlurb}>
                    p50, p95 and error counts for each one, ranked.
                  </Text>
                  <Text style={styles.catCount}>{report.routes.length} endpoints ›</Text>
                </View>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.footnote}>
              Measured {new Date(report.generated_at).toLocaleString()}.{'\n'}
              Every request is also logged with its route and duration, so the long-term
              record survives a restart even though this window does not.
            </Text>
          </>
        ) : (
          <Endpoints
            routes={sorted}
            slowestP95={slowestP95}
            sort={sort}
            sortBlurb={activeSort.blurb}
            onSort={setSort}
            expandedRoute={expandedRoute}
            onToggleRoute={(key) => setExpandedRoute(expandedRoute === key ? null : key)}
          />
        )}
      </ScrollView>
    </View>
  );
}

// ── Endpoint table ──────────────────────────────────────────────────────────

function Endpoints({
  routes,
  slowestP95,
  sort,
  sortBlurb,
  onSort,
  expandedRoute,
  onToggleRoute,
}: {
  routes: readonly LatencyRoute[];
  slowestP95: number;
  sort: RouteSortId;
  sortBlurb: string;
  onSort: (id: RouteSortId) => void;
  expandedRoute: string | null;
  onToggleRoute: (key: string) => void;
}) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (routes.length === 0) {
    return (
      <Text style={styles.sectionBlurb}>
        No requests recorded yet. The window starts empty after every deploy.
      </Text>
    );
  }

  return (
    <>
      <View style={styles.sortRow}>
        {ROUTE_SORTS.map((s) => {
          const isActive = sort === s.id;
          return (
            <TouchableOpacity
              key={s.id}
              style={[styles.sortBtn, isActive && styles.sortBtnActive]}
              onPress={() => onSort(s.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.sortText, isActive && styles.sortTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.sectionBlurb}>{sortBlurb}</Text>

      {routes.map((r) => {
        const key = `${r.method} ${r.route}`;
        const t = statusTokens[r.status];
        const expanded = expandedRoute === key;
        return (
          <TouchableOpacity
            key={key}
            style={styles.card}
            onPress={() => onToggleRoute(key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <View style={styles.routeTop}>
              <Text style={styles.routeMethod}>{r.method}</Text>
              <Text style={styles.routePath} numberOfLines={2}>
                {r.route}
              </Text>
              <View style={[styles.chip, { backgroundColor: t.chipBg }]}>
                <Text style={[styles.chipText, { color: t.chipInk }]}>{STATUS_LABEL[r.status]}</Text>
              </View>
            </View>

            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${routeBarPct(r, slowestP95)}%`, backgroundColor: t.mark },
                ]}
              />
            </View>

            <View style={styles.routeStats}>
              <Text style={styles.routeStat}>
                p95 <Text style={styles.routeStatValue}>{formatMs(r.p95_ms)}</Text>
              </Text>
              <Text style={styles.routeStat}>
                p50 <Text style={styles.routeStatValue}>{formatMs(r.p50_ms)}</Text>
              </Text>
              <Text style={styles.routeStat}>
                {formatCount(r.count)} req
              </Text>
              {r.server_errors > 0 ? (
                <Text style={[styles.routeStat, { color: statusTokens.fail.chipInk }]}>
                  {r.server_errors} failed
                </Text>
              ) : null}
            </View>

            {expanded ? (
              <View style={styles.explainBox}>
                <Text style={styles.explainRow}>
                  p99 {formatMs(r.p99_ms)} · slowest ever {formatMs(r.max_ms)} · average{' '}
                  {formatMs(r.avg_ms)}
                </Text>
                <Text style={styles.explainRow}>
                  {r.count.toLocaleString()} requests, {r.sampled.toLocaleString()} in the
                  percentile window · {r.server_errors} server errors ({r.server_error_rate}%) ·{' '}
                  {r.client_errors} rejected as bad requests
                </Text>
                <Text style={styles.explainMeaning}>
                  {STATUS_MEANING[r.status]} — bar width is this endpoint&apos;s p95 relative to the
                  slowest one.
                </Text>
              </View>
            ) : (
              <Text style={styles.explainPrompt}>Tap for p99, peak and error detail</Text>
            )}
          </TouchableOpacity>
        );
      })}
    </>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.paper },
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },
  tabActive: { backgroundColor: c.primary, borderColor: c.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: '#FFFFFF' },

  scroll: { padding: 16, paddingBottom: 48 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  heroChipText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  heroTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  heroSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  heroExplain: { fontSize: 13, lineHeight: 19, color: c.textSecondary, marginTop: 12 },

  card: {
    backgroundColor: c.paper,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  jumpRow: { flexDirection: 'row', alignItems: 'center' },
  catBlurb: { fontSize: 12, color: c.textSecondary, marginTop: 4, lineHeight: 17 },
  catCount: { fontSize: 12, color: c.primary, fontWeight: '600', marginTop: 8 },

  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
  },
  sortBtnActive: { backgroundColor: c.primary, borderColor: c.primary },
  sortText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  sortTextActive: { color: '#FFFFFF' },

  sectionBlurb: { fontSize: 13, lineHeight: 19, color: c.textSecondary },

  routeTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  routeMethod: {
    fontSize: 11,
    fontWeight: '800',
    color: c.textTertiary,
    letterSpacing: 0.5,
    marginTop: 1,
  },
  routePath: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: c.text,
    // Templates read as code; a mono face keeps {movie_id} legible. iOS has no
    // "monospace" alias, so name a real face there.
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },

  barTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
    marginTop: 10,
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },

  routeStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  routeStat: { fontSize: 12, color: c.textSecondary },
  routeStatValue: { fontWeight: '700', color: c.text },

  explainPrompt: { fontSize: 11, color: c.textTertiary, marginTop: 10 },
  explainBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
  explainRow: { fontSize: 12, lineHeight: 18, color: c.text, marginBottom: 6 },
  explainMeaning: { fontSize: 11, color: c.textTertiary, fontStyle: 'italic' },

  footnote: { fontSize: 11, color: c.textTertiary, marginTop: 16, lineHeight: 16 },
});

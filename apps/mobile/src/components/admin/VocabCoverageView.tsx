/**
 * VocabCoverageView — the charted, categorised body of the admin vocab-pipeline
 * health screen. Presentation only: all grouping, copy and meter geometry come
 * from `vocabCoverageContent`, all thresholds come from the server.
 *
 * Form follows the data's job (see the dataviz guidance):
 * - bounded metrics (a %, or spend vs cap) render as a **meter** with threshold
 *   markers, so you can see where the value sits relative to warn/fail;
 * - unbounded counts render as a **stat tile** with a trend line — never a
 *   one-bar bar chart;
 * - the overview's ok/warn/fail split is a part-to-whole **stacked bar** with a
 *   legend, since it's the only place multiple classes share one scale.
 *
 * Status is never encoded by colour alone — every mark is paired with a text
 * label, and every value is printed rather than hidden behind a tap.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { VocabCoverageMetric, VocabCoverageReport, VocabCoverageStatus } from '../../services/api';
import { COLORS, STATUS_LABEL, STATUS_MEANING, STATUS_TOKENS } from './adminTheme';
import {
  explanationFor,
  formatMetricValue,
  formatTrend,
  groupMetricsByCategory,
  meterGeometry,
  statusCounts,
  worstStatus,
  type CoverageCategoryId,
} from './vocabCoverageContent';

type TabId = CoverageCategoryId | 'overview';

const STATUS_ORDER: VocabCoverageStatus[] = ['ok', 'warn', 'fail'];

export function VocabCoverageView({ report }: { report: VocabCoverageReport }) {
  const [tab, setTab] = useState<TabId>('overview');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const sections = useMemo(() => groupMetricsByCategory(report.metrics), [report.metrics]);
  const counts = useMemo(() => statusCounts(report.metrics), [report.metrics]);
  const total = report.metrics.length;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    ...sections.map((s) => ({ id: s.category.id as TabId, label: s.category.label })),
  ];

  const active = sections.find((s) => s.category.id === tab);

  return (
    <View style={styles.flex}>
      {/* Tab row — horizontally scrollable so it survives narrow phones and
          long category names on both platforms. */}
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
        >
          {tabs.map((t) => {
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
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {tab === 'overview' ? (
          <Overview
            report={report}
            counts={counts}
            total={total}
            sections={sections}
            onJump={(id) => setTab(id)}
          />
        ) : active ? (
          <>
            <Text style={styles.sectionBlurb}>{active.category.blurb}</Text>
            {active.metrics.map((m) => (
              <MetricCard
                key={m.key}
                metric={m}
                expanded={expandedKey === m.key}
                onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function Overview({
  report,
  counts,
  total,
  sections,
  onJump,
}: {
  report: VocabCoverageReport;
  counts: Record<VocabCoverageStatus, number>;
  total: number;
  sections: ReturnType<typeof groupMetricsByCategory>;
  onJump: (id: CoverageCategoryId) => void;
}) {
  const overall = report.overall_status;
  const tokens = STATUS_TOKENS[overall];
  const checkedAt = new Date(report.generated_at).toLocaleString();

  return (
    <>
      {/* Hero: the one number this screen leads with. */}
      <View style={styles.hero}>
        <View style={[styles.heroChip, { backgroundColor: tokens.chipBg }]}>
          <Text style={[styles.heroChipText, { color: tokens.chipInk }]}>
            {STATUS_LABEL[overall]}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>Vocabulary pipeline</Text>
          <Text style={styles.heroSub}>
            {counts.fail > 0
              ? `${counts.fail} of ${total} checks need attention`
              : counts.warn > 0
                ? `${counts.warn} of ${total} checks worth watching`
                : `All ${total} checks healthy`}
          </Text>
        </View>
      </View>

      <Text style={styles.heroExplain}>
        This traces a word from a movie script all the way to what a learner sees:
        words → example sentences → translations. Each check below watches one step.
      </Text>

      {/* Part-to-whole: how the checks split across statuses. */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Check health</Text>
        <View style={styles.stackTrack}>
          {STATUS_ORDER.map((s) =>
            counts[s] > 0 ? (
              <View
                key={s}
                style={[
                  styles.stackSeg,
                  { flex: counts[s], backgroundColor: STATUS_TOKENS[s].mark },
                ]}
              />
            ) : null
          )}
        </View>
        {/* Legend — required since several classes share one scale, and it keeps
            status off colour-alone. */}
        <View style={styles.legend}>
          {STATUS_ORDER.map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: STATUS_TOKENS[s].mark }]} />
              <Text style={styles.legendText}>
                {counts[s]} {STATUS_MEANING[s].toLowerCase()}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Category jump list. */}
      {sections.map((s) => {
        const worst = worstStatus(s.metrics);
        const t = STATUS_TOKENS[worst];
        return (
          <TouchableOpacity
            key={s.category.id}
            style={[styles.card, styles.catRow]}
            onPress={() => onJump(s.category.id)}
            activeOpacity={0.7}
          >
            <View style={styles.flex}>
              <View style={styles.catTitleRow}>
                <Text style={styles.cardTitle}>{s.category.label}</Text>
                <View style={[styles.chip, { backgroundColor: t.chipBg }]}>
                  <Text style={[styles.chipText, { color: t.chipInk }]}>{STATUS_LABEL[worst]}</Text>
                </View>
              </View>
              <Text style={styles.catBlurb}>{s.category.blurb}</Text>
              <Text style={styles.catCount}>
                {s.metrics.length} check{s.metrics.length === 1 ? '' : 's'} ›
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <Text style={styles.footnote}>
        Checked {checkedAt}.{'\n'}
        {report.previous_snapshot_at
          ? `Trends compare against the snapshot from ${new Date(report.previous_snapshot_at).toLocaleString()}.`
          : 'Trend arrows appear once the first daily snapshot has been written.'}
      </Text>
    </>
  );
}

// ── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  metric,
  expanded,
  onToggle,
}: {
  metric: VocabCoverageMetric;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tokens = STATUS_TOKENS[metric.status];
  const geo = meterGeometry(metric);
  const trend = formatTrend(metric);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityHint="Shows what this check means"
    >
      <View style={styles.metricTop}>
        <Text style={styles.cardTitle}>{metric.label}</Text>
        <View style={[styles.chip, { backgroundColor: tokens.chipBg }]}>
          <Text style={[styles.chipText, { color: tokens.chipInk }]}>
            {STATUS_LABEL[metric.status]}
          </Text>
        </View>
      </View>

      {/* Value is always printed — never gated behind the meter or a tap. */}
      <Text style={styles.metricValue}>{formatMetricValue(metric)}</Text>

      {trend ? (
        <Text
          style={[
            styles.metricTrend,
            { color: trend.good ? STATUS_TOKENS.ok.chipInk : STATUS_TOKENS.warn.chipInk },
          ]}
        >
          {trend.text}
        </Text>
      ) : null}

      {geo ? (
        <View style={styles.meterWrap}>
          <View style={styles.meterTrack}>
            <View
              style={[styles.meterFill, { width: `${geo.fillPct}%`, backgroundColor: tokens.mark }]}
            />
            {/* Threshold markers: solid hairlines, so "where warn/fail sits" is
                visible rather than something you infer from the caption. */}
            {geo.warnPct != null ? (
              <View style={[styles.meterMark, { left: `${geo.warnPct}%` }]} />
            ) : null}
            {geo.failPct != null ? (
              <View style={[styles.meterMark, { left: `${geo.failPct}%` }]} />
            ) : null}
          </View>
          <View style={styles.meterScale}>
            <Text style={styles.meterScaleText}>0</Text>
            <Text style={styles.meterScaleText}>
              {metric.unit === '%' ? '100%' : `$${metric.max_value}`}
            </Text>
          </View>
        </View>
      ) : null}

      {metric.detail ? <Text style={styles.metricDetail}>{metric.detail}</Text> : null}

      {expanded ? (
        <View style={styles.explainBox}>
          <Text style={styles.explainText}>{explanationFor(metric.key)}</Text>
          <Text style={styles.explainThreshold}>Alert rule: {metric.threshold}</Text>
        </View>
      ) : (
        <Text style={styles.explainPrompt}>Tap to see what this means</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.paper },
  tabRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  tabTextActive: { color: '#FFFFFF' },

  scroll: { padding: 16, paddingBottom: 48 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  heroChipText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  heroTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  heroSub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  heroExplain: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
    marginTop: 12,
  },

  card: {
    backgroundColor: COLORS.paper,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text },

  stackTrack: { flexDirection: 'row', gap: 2, height: 10, marginTop: 10 },
  stackSeg: { height: '100%', borderRadius: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: COLORS.textSecondary },

  catRow: { flexDirection: 'row', alignItems: 'center' },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catBlurb: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4, lineHeight: 17 },
  catCount: { fontSize: 12, color: COLORS.primary, fontWeight: '600', marginTop: 8 },

  sectionBlurb: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },

  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  metricValue: { fontSize: 26, fontWeight: '700', color: COLORS.text, marginTop: 8 },
  metricTrend: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  meterWrap: { marginTop: 12 },
  meterTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  meterMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: COLORS.text, opacity: 0.35 },
  meterScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  meterScaleText: { fontSize: 10, color: COLORS.textTertiary },

  metricDetail: { fontSize: 12, color: COLORS.textSecondary, marginTop: 10, lineHeight: 17 },

  explainPrompt: { fontSize: 11, color: COLORS.textTertiary, marginTop: 10 },
  explainBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  explainText: { fontSize: 13, lineHeight: 20, color: COLORS.text },
  explainThreshold: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 8,
    fontStyle: 'italic',
  },

  footnote: { fontSize: 11, color: COLORS.textTertiary, marginTop: 16, lineHeight: 16 },
});

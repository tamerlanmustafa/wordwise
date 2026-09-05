/**
 * VocabCoverageView — the charted, categorised body of the admin vocab-pipeline
 * health screen. Presentation only: grouping and copy come from
 * `vocabCoverageContent`, the metric card and formatting are shared with the
 * other health reports, and all thresholds come from the server.
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
import type { VocabCoverageReport, VocabCoverageStatus } from '../../services/api';
import { STATUS_LABEL, STATUS_MEANING, type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { HealthMetricCard } from './HealthMetricCard';
import { statusCounts, worstStatus } from './healthMetricContent';
import {
  explanationFor,
  formatTrend,
  groupMetricsByCategory,
  type CoverageCategoryId,
} from './vocabCoverageContent';

type TabId = CoverageCategoryId | 'overview';

const STATUS_ORDER: VocabCoverageStatus[] = ['ok', 'warn', 'fail'];

export function VocabCoverageView({ report }: { report: VocabCoverageReport }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
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
              <HealthMetricCard
                key={m.key}
                metric={m}
                explanation={explanationFor(m.key)}
                trend={formatTrend(m)}
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
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const overall = report.overall_status;
  const tokens = statusTokens[overall];
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

      {/* Where these numbers came from.
          Computing them live is ~5 seconds of counting across the largest
          tables we have, and the sentence worker already does exactly that
          once a day — so this opens on the stored answer. Saying so is not
          optional: the difference between "healthy" and "was healthy at 3am"
          is the whole value of the screen, and one metric here (snapshot age)
          exists precisely because a writer once died unnoticed for five days. */}
      {report.from_snapshot ? (
        <Text style={styles.provenance}>
          Measured{' '}
          {report.captured_at ? new Date(report.captured_at).toLocaleString() : 'earlier'}, when the
          sentence worker last checked. Pull to refresh to recount now — it takes a few seconds.
        </Text>
      ) : (
        <Text style={styles.provenance}>Counted just now, at {checkedAt}.</Text>
      )}

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
                  { flex: counts[s], backgroundColor: statusTokens[s].mark },
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
              <View style={[styles.legendDot, { backgroundColor: statusTokens[s].mark }]} />
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
        const t = statusTokens[worst];
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

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
  flex: { flex: 1 },
  tabBar: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.paper },
  tabRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
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
  heroExplain: {
    fontSize: 13,
    lineHeight: 19,
    color: c.textSecondary,
    marginTop: 12,
  },
  provenance: {
    fontSize: 12,
    lineHeight: 17,
    color: c.textTertiary,
    marginTop: 8,
  },

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

  stackTrack: { flexDirection: 'row', gap: 2, height: 10, marginTop: 10 },
  stackSeg: { height: '100%', borderRadius: 5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: c.textSecondary },

  catRow: { flexDirection: 'row', alignItems: 'center' },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catBlurb: { fontSize: 12, color: c.textSecondary, marginTop: 4, lineHeight: 17 },
  catCount: { fontSize: 12, color: c.primary, fontWeight: '600', marginTop: 8 },

  sectionBlurb: {
    fontSize: 13,
    lineHeight: 19,
    color: c.textSecondary,
    marginBottom: 2,
  },

  footnote: { fontSize: 11, color: c.textTertiary, marginTop: 16, lineHeight: 16 },
});

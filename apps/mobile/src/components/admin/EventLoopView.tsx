/**
 * EventLoopView — the body of the admin event-loop screen (issue #146).
 *
 * Two halves, because they answer different questions:
 * - the headline metrics ("is the server holding its own turn hostage") render
 *   with the shared HealthMetricCard, same as every other /admin/health/* report;
 * - the recent-stall list ("when exactly") is a timestamped log, because the
 *   timestamps are the only route to attribution — lag itself never names the
 *   handler that stalled.
 *
 * The attribution caveat is printed on the screen rather than left to the docs:
 * this is the surface where someone will try to read a culprit out of a number
 * that cannot contain one.
 *
 * Status is never colour-alone — every row prints its duration and carries a
 * text chip. Copy comes from `eventLoopContent`; thresholds come from the server.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { EventLoopReport } from '../../services/api';
import { STATUS_LABEL, type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { HealthMetricCard } from './HealthMetricCard';
import { statusCounts } from './healthMetricContent';
import {
  ATTRIBUTION_NOTE,
  describeStall,
  explanationForEventLoopMetric,
  stallBarPct,
  windowSummary,
} from './eventLoopContent';
import { formatMs } from './latencyContent';

export function EventLoopView({ report }: { report: EventLoopReport }) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const counts = useMemo(() => statusCounts(report.metrics), [report.metrics]);
  const worstStall = useMemo(
    () => report.recent_stalls.reduce((max, s) => Math.max(max, s.lag_ms), 0),
    [report.recent_stalls]
  );

  const tokens = statusTokens[report.overall_status];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.hero}>
        <View style={[styles.heroChip, { backgroundColor: tokens.chipBg }]}>
          <Text style={[styles.heroChipText, { color: tokens.chipInk }]}>
            {STATUS_LABEL[report.overall_status]}
          </Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.heroTitle}>Server responsiveness</Text>
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
          explanation={explanationForEventLoopMetric(m.key)}
          expanded={expandedKey === m.key}
          onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)}
        />
      ))}

      <Text style={styles.sectionLabel}>Recent stalls</Text>
      {report.recent_stalls.length === 0 ? (
        <Text style={styles.sectionBlurb}>
          None recorded. Every request the API has taken since it restarted got its turn
          on time.
        </Text>
      ) : (
        <>
          <Text style={styles.sectionBlurb}>
            Newest first. Each one is a moment the whole API answered nobody.
          </Text>
          {report.recent_stalls.map((stall) => {
            const t = statusTokens[stall.severity === 'severe' ? 'fail' : 'warn'];
            return (
              <View key={`${stall.at}-${stall.lag_ms}`} style={styles.card}>
                <View style={styles.stallTop}>
                  <Text style={styles.stallValue}>{formatMs(stall.lag_ms)}</Text>
                  <View style={[styles.chip, { backgroundColor: t.chipBg }]}>
                    <Text style={[styles.chipText, { color: t.chipInk }]}>
                      {stall.severity === 'severe' ? 'Severe' : 'Stall'}
                    </Text>
                  </View>
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${stallBarPct(stall, worstStall)}%`, backgroundColor: t.mark },
                    ]}
                  />
                </View>
                <Text style={styles.stallText}>{describeStall(stall)}</Text>
                <Text style={styles.stallStamp}>{new Date(stall.at).toLocaleString()}</Text>
              </View>
            );
          })}
        </>
      )}

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Finding the culprit</Text>
        <Text style={styles.noteText}>{ATTRIBUTION_NOTE}</Text>
      </View>

      <Text style={styles.footnote}>
        Measured {new Date(report.generated_at).toLocaleString()}.{'\n'}
        Every stall is also written to the logs as a warning, so the record survives a
        restart even though this window does not.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
  flex: { flex: 1 },
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
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  sectionBlurb: { fontSize: 13, lineHeight: 19, color: c.textSecondary },

  stallTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stallValue: { fontSize: 20, fontWeight: '800', color: c.text },
  stallText: { fontSize: 13, lineHeight: 19, color: c.text, marginTop: 8 },
  stallStamp: { fontSize: 11, color: c.textTertiary, marginTop: 4 },

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

  noteBox: {
    marginTop: 24,
    padding: 14,
    borderRadius: 12,
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.border,
  },
  noteTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 6 },
  noteText: { fontSize: 12, lineHeight: 18, color: c.textSecondary },

  footnote: { fontSize: 11, color: c.textTertiary, marginTop: 16, lineHeight: 16 },
});

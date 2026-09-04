/**
 * HealthMetricCard — one metric from any /admin/health/* report.
 *
 * Shared by the vocab-coverage and latency views so a metric looks and behaves
 * the same wherever it appears. Presentation only: the caller supplies the
 * plain-English explanation and (where the report has one) the trend line,
 * since those are report-specific; everything else comes off the metric.
 *
 * Status is never encoded by colour alone — every mark is paired with a text
 * label, and the value is always printed rather than hidden behind a tap.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { HealthMetric } from '../../services/api';
import { STATUS_LABEL, type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { formatMetricValue, meterGeometry } from './healthMetricContent';

export interface MetricTrend {
  text: string;
  good: boolean;
}

export function HealthMetricCard({
  metric,
  explanation,
  trend,
  expanded,
  onToggle,
}: {
  metric: HealthMetric;
  explanation: string;
  trend?: MetricTrend | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const tokens = statusTokens[metric.status];
  const geo = meterGeometry(metric);

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

      <Text style={styles.metricValue}>{formatMetricValue(metric)}</Text>

      {trend ? (
        <Text
          style={[
            styles.metricTrend,
            { color: trend.good ? statusTokens.ok.chipInk : statusTokens.warn.chipInk },
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
          <Text style={styles.explainText}>{explanation}</Text>
          <Text style={styles.explainThreshold}>Alert rule: {metric.threshold}</Text>
        </View>
      ) : (
        <Text style={styles.explainPrompt}>Tap to see what this means</Text>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
  card: {
    backgroundColor: c.paper,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: c.border,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: c.text },

  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  metricValue: { fontSize: 26, fontWeight: '700', color: c.text, marginTop: 8 },
  metricTrend: { fontSize: 12, fontWeight: '600', marginTop: 2 },

  meterWrap: { marginTop: 12 },
  meterTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  meterFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999 },
  meterMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: c.text,
    opacity: 0.35,
  },
  meterScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  meterScaleText: { fontSize: 10, color: c.textTertiary },

  metricDetail: { fontSize: 12, color: c.textSecondary, marginTop: 10, lineHeight: 17 },

  explainPrompt: { fontSize: 11, color: c.textTertiary, marginTop: 10 },
  explainBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  explainText: { fontSize: 13, lineHeight: 20, color: c.text },
  explainThreshold: {
    fontSize: 11,
    color: c.textTertiary,
    marginTop: 8,
    fontStyle: 'italic',
  },
});

/**
 * ClientIpView — the body of the admin client-IP screen (issue #139).
 *
 * Three parts, because the question needs all three to answer:
 * - the headline checks, on the shared HealthMetricCard like every other
 *   /admin/health/* report;
 * - a trace of what this request actually carried, with the value the throttles
 *   used marked — the finding is *which* address is being counted, and an
 *   address on its own never shows that;
 * - the next step, printed on screen, because the remaining work is a Cloudflare
 *   rule and a Railway variable, not a code change anyone can find from here.
 *
 * The measurement caveat is on the screen for the same reason the event-loop
 * view prints its attribution caveat: this is where someone will read a result
 * that does not mean what it appears to.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ClientIpReport } from '../../services/api';
import { STATUS_LABEL, type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { HealthMetricCard } from './HealthMetricCard';
import {
  MEASUREMENT_NOTE,
  explanationForClientIpMetric,
  keySummary,
  traceRows,
  verdict,
} from './clientIpContent';

export function ClientIpView({ report }: { report: ClientIpReport }) {
  const c = useAdminColors();
  const statusTokens = useStatusTokens();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const rows = useMemo(() => traceRows(report.observed), [report.observed]);
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
          <Text style={styles.heroTitle}>Attempt limits</Text>
          <Text style={styles.heroSub}>{verdict(report)}</Text>
        </View>
      </View>

      <Text style={styles.heroExplain}>{MEASUREMENT_NOTE}</Text>

      {report.metrics.map((m) => (
        <HealthMetricCard
          key={m.key}
          metric={m}
          explanation={explanationForClientIpMetric(m.key)}
          expanded={expandedKey === m.key}
          onToggle={() => setExpandedKey(expandedKey === m.key ? null : m.key)}
        />
      ))}

      <Text style={styles.sectionLabel}>What this request carried</Text>
      <Text style={styles.sectionBlurb}>{keySummary(report.observed)}</Text>
      <View style={styles.card}>
        {rows.map((row) => (
          <View key={row.label} style={styles.traceRow}>
            <View style={styles.traceHead}>
              <Text style={styles.traceLabel}>{row.label}</Text>
              {row.used ? (
                <View style={[styles.chip, { backgroundColor: tokens.chipBg }]}>
                  <Text style={[styles.chipText, { color: tokens.chipInk }]}>Counted</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.traceValue}>{row.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Next step</Text>
        <Text style={styles.noteText}>{report.next_step}</Text>
      </View>

      <Text style={styles.footnote}>
        Measured {new Date(report.generated_at).toLocaleString()}.{'\n'}
        Signed-in requests are counted per account and are unaffected by any of this —
        only signed-out ones have nothing but an address to go on.
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

  traceRow: { marginBottom: 12 },
  traceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  traceLabel: { fontSize: 12, fontWeight: '700', color: c.textTertiary },
  traceValue: { fontSize: 14, color: c.text, marginTop: 2 },

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

/**
 * WorkersView — the four background processes, explained and measured.
 *
 * Every worker gets the same three-part card: what it is, how it is doing, and
 * the numbers. The explanation is not padding — the pipeline is invisible from
 * inside the app, and a page of raw counts ("pending 32, skipped 2,059") is
 * unreadable to anyone who has not already read the worker source.
 *
 * Presentation only: the copy, the health rules and the number formatting all
 * live in `workersContent`, which is pure and tested.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AdminWorkers } from '../../services/api';
import { type AdminColors, useAdminColors, useStatusTokens } from './adminTheme';
import { Card, EmptyState, Row, Section } from './AdminUI';
import {
  WORKERS,
  WORKER_HEALTH_LABEL,
  workerHealth,
  workerStats,
  type WorkerHealth,
} from './workersContent';

export function WorkersView({
  data,
  onOpenDead,
}: {
  data: AdminWorkers | null;
  /** Opens the list of films every subtitle source refused. Reachable from
   *  here rather than the hub: a dead job is a fact about the ingestion
   *  worker, and this is the page about that worker. */
  onOpenDead: () => void;
}) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  const statusTokens = useStatusTokens();
  // Explanations start collapsed. Someone checking whether a worker is alive
  // wants the status line; someone who has never seen the pipeline wants the
  // paragraph. Collapsed-by-default serves the first without hiding the second.
  const [openId, setOpenId] = useState<string | null>(null);

  if (!data) {
    return <EmptyState message="No worker data yet. The background workers have not reported in." />;
  }

  const toneFor = (h: WorkerHealth) =>
    h === 'off' ? c.textTertiary : statusTokens[h].mark;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.intro}>
        Four processes run alongside the app. Nothing here is something a user ever sees
        directly — but if one of them stops, something they do see gets slower, blanker or
        older. Tap a worker to read what it does.
      </Text>

      {WORKERS.map((w) => {
        const health = workerHealth(w.id, data);
        const stats = workerStats(w.id, data);
        const open = openId === w.id;
        return (
          <View key={w.id} style={styles.workerBlock}>
            <TouchableOpacity
              style={styles.headerRow}
              onPress={() => setOpenId(open ? null : w.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={`${w.name}, ${WORKER_HEALTH_LABEL[health]}`}
            >
              <View style={styles.headerText}>
                <Text style={styles.workerName}>{w.name}</Text>
                <Text style={styles.workerSummary}>{w.summary}</Text>
              </View>
              <View style={styles.headerEnd}>
                {/* Status is never colour alone — the word carries it too, for
                    anyone who cannot separate the two marks. */}
                <View style={[styles.pill, { borderColor: toneFor(health) }]}>
                  <View style={[styles.dot, { backgroundColor: toneFor(health) }]} />
                  <Text style={[styles.pillText, { color: toneFor(health) }]}>
                    {WORKER_HEALTH_LABEL[health]}
                  </Text>
                </View>
                <Text style={styles.chevron}>{open ? '−' : '+'}</Text>
              </View>
            </TouchableOpacity>

            {open ? (
              <View style={styles.explainerBox}>
                <Text style={styles.explainer}>{w.explainer}</Text>
                <Text style={styles.healthyLabel}>What healthy looks like</Text>
                <Text style={styles.healthy}>{w.healthy}</Text>
              </View>
            ) : null}

            <Card>
              {stats.map((s, i) => (
                <View key={s.label}>
                  <Row label={s.label} value={s.value} />
                  {s.hint ? <Text style={styles.hint}>{s.hint}</Text> : null}
                  {i < stats.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}
              {w.id === 'job' && data.queue.dead > 0 ? (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={onOpenDead}
                  accessibilityRole="button"
                >
                  <Text style={styles.linkBtnText}>
                    See the {data.queue.dead.toLocaleString()} it gave up on {'›'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          </View>
        );
      })}

      <Section
        title="Reading this page"
        hint={
          'A worker that has been quiet is not necessarily broken — it may simply have nothing ' +
          'left to do. That is why every card shows when it last did something rather than only ' +
          'how much it has done. "Check" means there is work outstanding and no sign of anyone ' +
          'doing it.'
        }
      />
    </ScrollView>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
    scroll: {
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    intro: {
      fontSize: 13.5,
      lineHeight: 20,
      color: c.textSecondary,
      marginTop: 14,
      marginBottom: 18,
    },
    workerBlock: {
      marginBottom: 18,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 10,
    },
    headerText: {
      flex: 1,
    },
    headerEnd: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    workerName: {
      fontSize: 16,
      fontWeight: '700',
      color: c.text,
    },
    workerSummary: {
      fontSize: 12.5,
      lineHeight: 17,
      color: c.textSecondary,
      marginTop: 2,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderWidth: 1,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    pillText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    chevron: {
      fontSize: 18,
      lineHeight: 20,
      color: c.textTertiary,
      width: 14,
      textAlign: 'center',
    },
    explainerBox: {
      backgroundColor: c.inset,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    explainer: {
      fontSize: 13.5,
      lineHeight: 20,
      color: c.text,
    },
    healthyLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 12,
      marginBottom: 4,
    },
    healthy: {
      fontSize: 13,
      lineHeight: 19,
      color: c.textSecondary,
    },
    hint: {
      fontSize: 11.5,
      lineHeight: 16,
      color: c.textTertiary,
      marginTop: -2,
      marginBottom: 2,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: 4,
    },
    linkBtn: {
      marginTop: 10,
      paddingVertical: 8,
    },
    linkBtnText: {
      fontSize: 13.5,
      fontWeight: '600',
      color: c.primary,
    },
  });

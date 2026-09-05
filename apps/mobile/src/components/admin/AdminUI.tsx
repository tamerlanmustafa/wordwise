/**
 * The pieces every admin page is built from.
 *
 * The admin screen was one 1,900-line file backed by one endpoint. Splitting
 * it into pages means several files now need the same stat tile, the same
 * section heading and the same "no data yet" state — so they live here once
 * rather than being copied five times, which is how six near-identical
 * StatCards end up with five different corner radii.
 *
 * Presentation only, and theme-derived like the rest of admin: every colour
 * comes from `useAdminColors()`, never a literal, so these render correctly on
 * both schemes and on both platforms.
 */

import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { type AdminColors, useAdminColors } from './adminTheme';

/** A single number with a label, optionally tappable. The admin dashboard's
 *  atom — a count, a percentage, a status word. */
export function StatTile({
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
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
      >
        {body}
      </TouchableOpacity>
    );
  }
  return (
    <View
      style={[styles.statCard, { borderStartColor: color }]}
      accessibilityLabel={`${label}: ${value}`}
    >
      {body}
    </View>
  );
}

/** The wrapping row that lays StatTiles out two-up on a phone and wider on a
 *  tablet. Tiles size themselves; this only owns the gaps. */
export function StatGrid({ children }: { children: ReactNode }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <View style={styles.statsGrid}>{children}</View>;
}

/** An uppercase section heading with an optional sentence of plain-English
 *  context under it. The hint is not decoration: half these numbers are
 *  meaningless without one line saying what "processed" or "UNKNOWN" means. */
export function Section({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      {children}
    </>
  );
}

/** A raised panel — what a chart or a list of rows sits on. */
export function Card({ children }: { children: ReactNode }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <View style={styles.card}>{children}</View>;
}

/** One label/value line inside a Card. */
export function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.rowValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

/** Centred spinner for a page that is fetching for the first time. */
export function PageLoading() {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.loadingBox}>
      <ActivityIndicator size="large" color={c.primary} />
    </View>
  );
}

/** What a page shows when its call came back with nothing — a worker that has
 *  never run, a table that does not exist on this environment. Says so, rather
 *  than rendering a grid of zeroes that reads as real data. */
export function EmptyState({ message }: { message: string }) {
  const c = useAdminColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.emptyBox}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 20,
      marginBottom: 10,
    },
    sectionHint: {
      fontSize: 12.5,
      lineHeight: 18,
      color: c.textSecondary,
      marginBottom: 10,
      marginTop: -4,
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
      // Android ignores shadow*; without this the tiles are flat next to iOS.
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
    card: {
      backgroundColor: c.paper,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: 16,
      marginBottom: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 7,
    },
    rowLabel: {
      flex: 1,
      fontSize: 13.5,
      color: c.textSecondary,
    },
    rowValue: {
      fontSize: 14.5,
      fontWeight: '600',
      color: c.text,
    },
    loadingBox: {
      paddingVertical: 48,
      alignItems: 'center',
    },
    emptyBox: {
      paddingVertical: 32,
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 13.5,
      lineHeight: 20,
      color: c.textTertiary,
      textAlign: 'center',
    },
  });

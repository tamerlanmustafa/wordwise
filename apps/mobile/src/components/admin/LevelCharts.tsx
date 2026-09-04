/**
 * LevelCharts — the two shapes the admin dashboard needs to show a CEFR
 * breakdown: a donut for "how is the whole split", and a ranked bar list for
 * "how big is each band next to the others".
 *
 * Both take the same `{ label, value, color }[]`, so a caller can render the
 * same data either way and the two can never disagree about a total.
 *
 * ## Why a donut and not a pie
 *
 * A pie asks you to compare wedge *areas*, which people read badly; a donut
 * leaves a hole for the total, which is the number anyone actually wants off
 * this chart ("4,430 films"). The arcs are still there for the shape of the
 * split, and every segment's exact value is printed in the legend beneath —
 * the chart is never the only place a number appears, which is the same rule
 * the health meters follow.
 *
 * ## Drawing
 *
 * One `<Circle>` per segment with a `strokeDasharray` of [arc, rest] and a
 * rotation, rather than a `<Path>` per wedge: no arc-flag trigonometry to get
 * wrong, and the geometry is a pure function (`donutSegments`) that unit tests
 * can check without rendering anything.
 *
 * No animation. Practice's 3D tiles hit RN-SVG's Fabric limitation where
 * animated SVG props do not update natively, and an admin dashboard is the
 * last place worth spending a workaround on.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { MONO_FAMILY } from '../../theme/fonts';
import { alignEnd } from '../../i18n/rtl';
import { useAdminColors, type AdminColors } from './adminTheme';

export interface ChartSlice {
  label: string;
  value: number;
  color: string;
}

// ── Pure geometry (unit-tested; see __tests__/levelCharts.test.ts) ──────────

export interface DonutSegment extends ChartSlice {
  /** Length of this segment's stroke along the circumference. */
  dash: number;
  /** Gap that follows it — the rest of the circle. */
  gap: number;
  /** Degrees to rotate so the segment starts where the previous one ended. */
  rotation: number;
  /** Share of the total, 0–100, already rounded for display. */
  pct: number;
}

/**
 * Turns values into stroke-dash segments around a circle of circumference `c`.
 *
 * Zero-valued slices are dropped rather than drawn as invisible zero-length
 * arcs: they would still occupy a legend row and imply the band exists in the
 * data when it does not. A total of 0 yields nothing at all, which the caller
 * renders as an empty state.
 */
export function donutSegments(slices: readonly ChartSlice[], c: number): DonutSegment[] {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  if (total <= 0) return [];

  let offset = 0;
  const out: DonutSegment[] = [];
  for (const slice of slices) {
    const value = Math.max(0, slice.value);
    if (value === 0) continue;
    const fraction = value / total;
    const dash = fraction * c;
    out.push({
      ...slice,
      dash,
      gap: c - dash,
      // -90 starts the first segment at twelve o'clock instead of three.
      rotation: -90 + offset * 360,
      pct: Math.round(fraction * 100),
    });
    offset += fraction;
  }
  return out;
}

/** Bar widths as percentages of the largest value, so the biggest bar fills. */
export function barWidths(slices: readonly ChartSlice[]): number[] {
  const max = Math.max(0, ...slices.map((s) => Math.max(0, s.value)));
  if (max <= 0) return slices.map(() => 0);
  return slices.map((s) => (Math.max(0, s.value) / max) * 100);
}

const compact = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`;

// ── Donut ───────────────────────────────────────────────────────────────────

const SIZE = 132;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const MID = SIZE / 2;

export function DonutChart({
  slices,
  total,
  caption,
}: {
  slices: readonly ChartSlice[];
  /** Printed in the hole. Passed rather than summed so the caller can show a
   *  total that includes buckets the chart deliberately omits. */
  total: number;
  caption: string;
}) {
  const c = useAdminColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const segments = useMemo(() => donutSegments(slices, CIRCUMFERENCE), [slices]);

  return (
    <View style={s.donutRow}>
      <View>
        <Svg width={SIZE} height={SIZE}>
          {/* Track, so an empty or partial chart still reads as a ring. */}
          <Circle
            cx={MID}
            cy={MID}
            r={RADIUS}
            stroke={c.inset}
            strokeWidth={STROKE}
            fill="none"
          />
          {segments.map((seg) => (
            <G key={seg.label} rotation={seg.rotation} origin={`${MID}, ${MID}`}>
              <Circle
                cx={MID}
                cy={MID}
                r={RADIUS}
                stroke={seg.color}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${seg.dash} ${seg.gap}`}
                strokeLinecap="butt"
              />
            </G>
          ))}
        </Svg>
        <View style={s.donutHole} pointerEvents="none">
          <Text style={s.donutTotal}>{compact(total)}</Text>
          <Text style={s.donutCaption}>{caption}</Text>
        </View>
      </View>

      {/* The legend carries the exact numbers. The arcs give the shape; nobody
          should have to estimate a value off a wedge. */}
      <View style={s.legend}>
        {segments.map((seg) => (
          <View key={seg.label} style={s.legendRow}>
            <View style={[s.swatch, { backgroundColor: seg.color }]} />
            <Text style={s.legendLabel}>{seg.label}</Text>
            <Text style={s.legendValue}>{seg.value.toLocaleString()}</Text>
            <Text style={s.legendPct}>{seg.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Bars ────────────────────────────────────────────────────────────────────

export function BarChart({ slices }: { slices: readonly ChartSlice[] }) {
  const c = useAdminColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const widths = useMemo(() => barWidths(slices), [slices]);

  return (
    <View style={s.bars}>
      {slices.map((slice, i) => (
        <View key={slice.label} style={s.barRow}>
          <Text style={s.barLabel}>{slice.label}</Text>
          <View style={s.barTrack}>
            <View
              style={[s.barFill, { width: `${widths[i]}%`, backgroundColor: slice.color }]}
            />
          </View>
          <Text style={s.barValue}>{slice.value.toLocaleString()}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: AdminColors) =>
  StyleSheet.create({
    donutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
    },
    donutHole: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    donutTotal: {
      fontFamily: MONO_FAMILY,
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
    },
    donutCaption: {
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: c.textTertiary,
      marginTop: 2,
    },
    legend: {
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    legendRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    swatch: {
      width: 9,
      height: 9,
      borderRadius: 2,
    },
    legendLabel: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
      width: 54,
    },
    legendValue: {
      flex: 1,
      minWidth: 0,
      textAlign: alignEnd,
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      color: c.textSecondary,
    },
    legendPct: {
      width: 38,
      textAlign: alignEnd,
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      color: c.textTertiary,
    },
    bars: {
      gap: 8,
    },
    barRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    barLabel: {
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
      width: 60,
    },
    barTrack: {
      flex: 1,
      height: 12,
      borderRadius: 6,
      backgroundColor: c.inset,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      borderRadius: 6,
    },
    barValue: {
      width: 62,
      textAlign: alignEnd,
      fontFamily: MONO_FAMILY,
      fontSize: 11,
      color: c.textSecondary,
    },
  });

/**
 * ContributionCalendar — a 7×N contribution grid using gold alphas for the
 * four intensity levels (Profile §C). Pure presentation over the
 * `calendarIntensity` selector's flat grid (most-recent day last).
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';

export interface ContributionCalendarProps {
  /** Flat `weeks × 7` intensities (0–3), most-recent day last. */
  grid: ReadonlyArray<0 | 1 | 2 | 3>;
  weeks?: number;
}

// Gold alphas per intensity. Index 0 is "empty" (uses the divider token).
const GOLD_ALPHA = ['', 'rgba(255,209,102,0.3)', 'rgba(255,209,102,0.6)', 'rgba(255,209,102,1)'];

export function ContributionCalendar({ grid, weeks = 5 }: ContributionCalendarProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Lay out column-major (each column a week of 7 days).
  const columns = Array.from({ length: weeks }).map((_, c) => grid.slice(c * 7, c * 7 + 7));

  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>Last {weeks} weeks</Text>
      <View style={s.grid}>
        {columns.map((col, ci) => (
          <View key={ci} style={s.col}>
            {col.map((intensity, ri) => (
              <View
                key={ri}
                style={[s.cell, { backgroundColor: intensity === 0 ? tc.divider : GOLD_ALPHA[intensity] }]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 8 },
    eyebrow: {
      fontFamily: MONO_FAMILY,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.6,
      color: tc.textFaint,
      textTransform: 'uppercase',
    },
    grid: { flexDirection: 'row', gap: 6 },
    col: { gap: 6 },
    cell: { width: 16, height: 16, borderRadius: 4 },
  });

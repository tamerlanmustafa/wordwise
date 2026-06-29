/**
 * ComprehensionByLevel — six labelled progress bars in CEFR colours (Profile
 * §C). Pure presentation over the `comprehensionByLevel` selector's output;
 * the screen passes real per-level data in.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { MONO_FAMILY } from '../../theme/fonts';
import type { ComprehensionByLevel as Row } from './statsSelectors';

export interface ComprehensionByLevelProps {
  rows: ReadonlyArray<Row>;
}

export function ComprehensionByLevel({ rows }: ComprehensionByLevelProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>Comprehension by level</Text>
      {rows.map((r) => (
        <View key={r.level} style={s.row}>
          <Text style={[s.level, { color: cefrColors[r.level] ?? tc.text }]}>{r.level}</Text>
          <View style={s.track}>
            <View style={[s.fill, { width: `${r.pct}%`, backgroundColor: cefrColors[r.level] ?? tc.gold }]} />
          </View>
          <Text style={s.pct}>{r.pct}%</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 10 },
    eyebrow: {
      fontFamily: MONO_FAMILY,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.6,
      color: tc.textFaint,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    level: { fontFamily: MONO_FAMILY, fontSize: 12, fontWeight: '900', width: 24 },
    track: { flex: 1, height: 8, borderRadius: 999, backgroundColor: tc.divider, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 999 },
    pct: { fontSize: 12, fontWeight: '700', color: tc.textSecondary, width: 38, textAlign: 'right' },
  });

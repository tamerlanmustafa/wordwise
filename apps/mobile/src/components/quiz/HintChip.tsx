/**
 * HintChip — single hint pill for the Translation Type card.
 *
 * Spec: `tabs2/quiz.jsx` hint-chip block. Padding 5×10, radius 999,
 * bg `tc.chipBg`, 1px `tc.border`, 11px weight 700, color `tc.textSecondary`.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

export interface HintChipProps {
  label: string;
}

export function HintChip({ label }: HintChipProps) {
  const tc = useThemeColors();
  const s = makeStyles(tc);
  return (
    <View style={s.chip}>
      <Text style={s.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
    },
    label: {
      fontSize: 11,
      fontWeight: '700',
      color: tc.textSecondary,
    },
  });

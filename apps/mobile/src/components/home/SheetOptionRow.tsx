/**
 * SheetOptionRow — one selectable row inside the Home sheets, plus the small
 * uppercase section label above a group of them.
 *
 * Extracted rather than duplicated because the level picker and the filter
 * sheet are two sheets showing the same kind of list: a leading swatch or
 * glyph, a label, a gold check on the active row. This is the descendant of
 * the old `FilterDropdown` inside LevelSortControls — same treatment, but as
 * sheet rows with real 48pt touch targets instead of an absolutely-positioned
 * paper menu that had to fight the search dropdown for z-index.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
  /** A CEFR colour chip (level rows) — mutually exclusive with `icon`. */
  swatch?: string;
  /** An emoji glyph (type rows) — mutually exclusive with `swatch`. */
  icon?: string;
  /** Shown just before the check on the active row — the sort direction. */
  trailing?: string;
  /** Hairline under the row; omit on the last row of a group. */
  divider?: boolean;
  accessibilityHint?: string;
}

export function SheetOptionRow({
  label,
  active,
  onPress,
  swatch,
  icon,
  trailing,
  divider = true,
  accessibilityHint,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <TouchableOpacity
      style={[s.row, divider && s.rowDivider, active && s.rowActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityHint={accessibilityHint}
    >
      {swatch ? (
        <View style={[s.swatch, { backgroundColor: swatch }]} />
      ) : (
        <Text style={s.icon}>{icon}</Text>
      )}
      <Text style={[s.label, active && s.labelActive]}>{label}</Text>
      {active && trailing ? <Text style={s.trailing}>{trailing}</Text> : null}
      {active ? (
        <HomeIcon name="check" size={17} color={tc.goldOnSurface} sw={2.6} />
      ) : null}
    </TouchableOpacity>
  );
}

export function SheetSectionLabel({ children }: { children: string }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return <Text style={s.sectionLabel}>{children}</Text>;
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      // 48 tall including padding — the minimum comfortable target on both
      // platforms, where the old dropdown rows were 37.
      paddingVertical: 13,
      paddingHorizontal: 12,
      borderRadius: 10,
    },
    rowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: tc.divider,
      borderBottomStartRadius: 0,
      borderBottomEndRadius: 0,
    },
    rowActive: {
      backgroundColor: tc.primaryTint,
    },
    swatch: {
      width: 10,
      height: 10,
      borderRadius: 3,
    },
    icon: {
      // Same 10pt column the CEFR swatch occupies, so labels line up whether a
      // row leads with a colour chip or an emoji.
      width: 10,
      fontSize: 14,
      textAlign: 'center',
    },
    label: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: tc.text,
    },
    labelActive: {
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    trailing: {
      fontSize: 15,
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    sectionLabel: {
      fontSize: 9.5,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.textFaint,
      textTransform: 'uppercase',
      paddingHorizontal: 12,
      marginTop: 14,
      marginBottom: 4,
    },
  });

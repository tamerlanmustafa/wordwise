/**
 * SheetOptionRow — one selectable row inside the Home sheets, plus the small
 * uppercase section label above a group of them.
 *
 * Extracted rather than duplicated because the sheet holds several groups of
 * the same kind of list: a leading swatch or glyph, a label, a gold check on
 * the active row. This is the descendant of the old `FilterDropdown` inside
 * LevelSortControls — same treatment, but as sheet rows with real 48pt touch
 * targets instead of an absolutely-positioned paper menu that had to fight the
 * search dropdown for z-index.
 *
 * The CEFR level is the one group that does *not* use these rows: six of them
 * cost 288pt, and the level is a scale rather than a menu, so `FeedFilterSheet`
 * draws it as a 44pt ladder instead.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';
import { FilmIcon, SparkleIcon } from '../ui/icons';
import type { MovieTypeIcon } from './filterOptions';

interface Props {
  label: string;
  active: boolean;
  onPress: () => void;
  /** A CEFR colour chip (level rows) — mutually exclusive with `icon`. */
  swatch?: string;
  /** A drawn icon (type rows) — mutually exclusive with `swatch`. Was an
   *  emoji glyph in a `<Text>`, which sat on the text baseline rather than in
   *  the row's layout box and was drawn by the OS in a font we don't control. */
  icon?: MovieTypeIcon;
  /** Shown just before the check on the active row — the sort direction.
   *  Omit for a sort that has no direction (see `sortHasDirection`). */
  trailing?: string;
  /** A quiet second line under the label, for a row whose behaviour isn't
   *  obvious from its name ("Recommended" → "a fresh set every 6 hours").
   *  One line only: the row grows to fit it, and a paragraph here would make
   *  three sort rows taller than the sheet's whole type group. */
  note?: string;
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
  note,
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
      ) : icon ? (
        <View style={s.icon}>
          {icon === 'sparkle' ? (
            <SparkleIcon size={17} color={tc.textSecondary} />
          ) : (
            <FilmIcon size={17} variant={icon === 'camera' ? 'camera' : 'clapper'} />
          )}
        </View>
      ) : null}
      <View style={s.labelCol}>
        <Text style={[s.label, active && s.labelActive]}>{label}</Text>
        {note ? <Text style={s.note}>{note}</Text> : null}
      </View>
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
      // The drawn icon is wider than the 10pt CEFR swatch, so it is centred in
      // a box of its own and the box is what keeps the labels aligned whether a
      // row leads with a colour chip or an icon. The old emoji sat in a `Text`
      // at 14pt and lined up by luck.
      width: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The label owns the flex now, not the Text — the note has to sit under
    // the label, and a `flex: 1` Text with a sibling below it would put the
    // two side by side.
    labelCol: {
      flex: 1,
      minWidth: 0,
    },
    label: {
      fontSize: 15,
      fontWeight: '600',
      color: tc.text,
    },
    note: {
      fontSize: 11.5,
      color: tc.textSecondary,
      marginTop: 2,
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

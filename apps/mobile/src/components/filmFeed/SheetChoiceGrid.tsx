/**
 * SheetChoiceGrid — a group of equal cells, exactly one selected, for the Home
 * sheets; plus the small uppercase label above each group.
 *
 * Replaces `SheetOptionRow`. The filter sheet drew its sort and film-type
 * groups as full-width rows and its level as a ladder of 44pt cells, and on an
 * iPhone SE the rows pushed the sheet past the top of the screen. Every group
 * is the ladder's shape now: fixed-height cells, so the sheet's height is the
 * sum in `filterSheetMetrics` rather than whatever the copy wraps to.
 *
 * The cell owns its press, so it taps back itself, the way `SegmentedControl`
 * does — the callbacks handed in stay bare, or one press is two buzzes.
 *
 * A label shrinks before it wraps and wraps before it clips (Spanish "Todas las
 * películas" in a third of a 375pt sheet is the case that needs both), and
 * neither ever changes the cell's height.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { withTap } from '../../utils/feedback';
import { CHOICE_GAP, CHOICE_HEIGHT, SECTION_LABEL } from './filterSheetMetrics';

export interface SheetChoice<T extends string> {
  value: T;
  label: string;
  /** Printed after the label, on the selected cell only — the sort direction. */
  trailing?: string;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

interface Props<T extends string> {
  choices: SheetChoice<T>[];
  selected: T;
  onSelect: (value: T) => void;
  columns: number;
  /** CEFR codes: one width in mono, so a row of them reads as a scale. */
  mono?: boolean;
}

export function SheetChoiceGrid<T extends string>({
  choices,
  selected,
  onSelect,
  columns,
  mono = false,
}: Props<T>) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const rows: SheetChoice<T>[][] = [];
  for (let i = 0; i < choices.length; i += columns) {
    rows.push(choices.slice(i, i + columns));
  }

  return (
    // `flexDirection: 'row'` mirrors under RTL along with everything else, so
    // A1 and Recommended stay on the leading edge.
    <View style={s.grid} accessibilityRole="radiogroup">
      {rows.map((row, r) => (
        <View key={r} style={s.row}>
          {row.map((choice) => {
            const active = choice.value === selected;
            return (
              <TouchableOpacity
                key={choice.value}
                style={[s.cell, active && s.cellOn]}
                onPress={withTap(() => onSelect(choice.value))}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={choice.accessibilityLabel ?? choice.label}
                accessibilityHint={choice.accessibilityHint}
              >
                <Text
                  style={[mono ? s.labelMono : s.label, active && s.labelOn]}
                  numberOfLines={mono ? 1 : 2}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {active && choice.trailing ? `${choice.label} ${choice.trailing}` : choice.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* A short last row keeps its cells the width of the rows above. */}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`spacer-${i}`} style={s.spacer} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function SheetSectionLabel({ children }: { children: string }) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return <Text style={s.sectionLabel}>{children}</Text>;
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    grid: {
      gap: CHOICE_GAP,
      paddingHorizontal: 12,
    },
    row: {
      flexDirection: 'row',
      gap: CHOICE_GAP,
    },
    cell: {
      flex: 1,
      height: CHOICE_HEIGHT,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    cellOn: {
      backgroundColor: tc.gold,
      borderColor: tc.gold,
    },
    spacer: {
      flex: 1,
    },
    label: {
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '700',
      color: tc.textSecondary,
      textAlign: 'center',
    },
    labelMono: {
      fontFamily: MONO_FAMILY,
      fontSize: 12.5,
      fontWeight: '700',
      color: tc.textSecondary,
    },
    // Gold-on-dark text is goldDeep, never white — white fails contrast.
    labelOn: {
      color: tc.goldDeep,
    },
    sectionLabel: {
      fontSize: 9.5,
      lineHeight: SECTION_LABEL.line,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.textFaint,
      textTransform: 'uppercase',
      paddingHorizontal: 12,
      marginTop: SECTION_LABEL.top,
      marginBottom: SECTION_LABEL.bottom,
    },
  });

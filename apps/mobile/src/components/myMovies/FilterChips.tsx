/**
 * FilterChips — v0.7 My Movies horizontal filter strip.
 *
 * Four static chips (All / In progress / Mastered / Not started) plus
 * CEFR chips for every level the user actually has at least one movie
 * in. Empty levels are NOT rendered so the strip stays clean for new
 * users with a thin reel.
 *
 * Active chip = solid `tc.text` background, `tc.gold` label. Inactive =
 * `tc.chipBg`, `tc.textSecondary` label, 1px `tc.border`. Spacing/size
 * spec from `tabs/my-movies.jsx → Chip`.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { MyMoviesFilter } from '../../stores/myMoviesStore';

export interface FilterChipsProps {
  /** All chip keys currently active for the user's reel — includes
   *  the 4 static keys plus dynamic CEFR keys ("B1", "B2", …). */
  available: MyMoviesFilter[];
  active: MyMoviesFilter;
  onChange: (f: MyMoviesFilter) => void;
}

const STATIC_LABEL: Record<MyMoviesFilter, string> = {
  all:         'All',
  in_progress: 'In progress',
  mastered:    'Mastered',
  not_started: 'Not started',
};

export function labelFor(f: MyMoviesFilter): string {
  return STATIC_LABEL[f] ?? String(f); // CEFR codes display verbatim
}

export function FilterChips({ available, active, onChange }: FilterChipsProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
    >
      {available.map((f) => {
        const on = f === active;
        return (
          <Pressable
            key={f}
            onPress={() => onChange(f)}
            style={({ pressed }) => [
              s.chip,
              on
                ? { backgroundColor: tc.text }
                : { backgroundColor: tc.chipBg, borderWidth: 1, borderColor: tc.border },
              pressed && { opacity: 0.85 },
            ]}
            hitSlop={4}
          >
            <Text
              style={[
                s.chipLabel,
                { color: on ? tc.gold : tc.textSecondary },
              ]}
              numberOfLines={1}
            >
              {labelFor(f)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (_tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      paddingHorizontal: 18,
      paddingBottom: 12,
      gap: 7,
    },
    chip: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
  });

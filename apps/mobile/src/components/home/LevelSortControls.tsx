/**
 * LevelSortControls — the level selector + sort chips beneath the feed
 * header, replacing the old purple `LevelToggle` row (and the now-removed
 * "🎮 Journey · Soon" pill).
 *
 * Layout — one wrapping chip row:
 *   • Sort chips: Rating / Popularity / Level %. Active = chipBgOn/chipTxtOn,
 *     inactive = chipBg/text2 + 1px border. Active chip shows a trailing
 *     ↓ (desc) / ↑ (asc); re-tapping the active sort flips direction.
 *   • Level chip, last in the row: gold `★ {level} ▾`. Tap → a paper dropdown
 *     where each option is a CEFR colour swatch + label; the active row is
 *     gold-tinted with a check.
 *
 * The level used to sit in a separate label row above the chips
 * (`SHOWING AT YOUR LEVEL` + a gold pill); it now shares the filter row. The
 * row wraps rather than clipping, since four chips overflow narrow phones.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { HomeIcon } from './HomeIcons';
import { LEVEL_OPTIONS } from './filterOptions';

export type LevelSort = 'rating' | 'popularity' | 'level';

const SORTS: Array<{ key: LevelSort; label: string }> = [
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'level', label: 'Level %' },
];

interface Props {
  level: string;
  onLevelChange: (level: string) => void;
  sort: LevelSort;
  sortAsc: boolean;
  /** Tap a sort chip: same key flips direction, new key selects it (desc). */
  onSortPress: (key: LevelSort) => void;
}

export function LevelSortControls({
  level,
  onLevelChange,
  sort,
  sortAsc,
  onSortPress,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <View style={s.wrap}>
      {/* Sort chips + the level filter chip at the end */}
      <View style={s.sortRow}>
        {SORTS.map((opt) => {
          const on = opt.key === sort;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[s.chip, on ? s.chipOn : s.chipOff]}
              onPress={() => onSortPress(opt.key)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, on ? s.chipTextOn : s.chipTextOff]}>
                {opt.label}
                {on ? (sortAsc ? ' ↑' : ' ↓') : ''}
              </Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[s.chip, s.levelChip]}
          onPress={() => setDropdownOpen((v) => !v)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Level ${level}. Tap to change.`}
        >
          <HomeIcon name="star" size={12} color={tc.goldDeep} />
          <Text style={[s.chipText, s.chipTextOn]}>{level}</Text>
          <HomeIcon name="chevron" size={13} color={tc.goldDeep} sw={2.6} />
        </TouchableOpacity>
      </View>

      {/* Level picker dropdown — CEFR swatches, active row gold-tinted */}
      {dropdownOpen ? (
        <View style={s.dropdown}>
          {LEVEL_OPTIONS.map((opt, i) => {
            const active = opt.value === level;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  s.dropdownRow,
                  i < LEVEL_OPTIONS.length - 1 && s.dropdownRowDivider,
                  active && s.dropdownRowActive,
                ]}
                onPress={() => {
                  setDropdownOpen(false);
                  if (opt.value !== level) onLevelChange(opt.value);
                }}
                activeOpacity={0.7}
              >
                <View
                  style={[s.swatch, { backgroundColor: cefrColors[opt.value] ?? tc.gold }]}
                />
                <Text style={[s.dropdownText, active && s.dropdownTextActive]}>
                  {opt.label}
                </Text>
                {active ? (
                  <View style={{ marginStart: 'auto' }}>
                    <HomeIcon name="check" size={15} color={tc.goldOnSurface} sw={2.6} />
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      position: 'relative',
      zIndex: 60,
    },
    dropdown: {
      position: 'absolute',
      // Just below the (first line of the) chip row: 30px chip + 4px gap.
      top: 34,
      end: 18,
      zIndex: 200,
      minWidth: 200,
      backgroundColor: tc.paper,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    dropdownRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
      paddingHorizontal: 14,
    },
    dropdownRowDivider: {
      borderBottomWidth: 1,
      borderBottomColor: tc.divider,
    },
    dropdownRowActive: {
      backgroundColor: tc.primaryTint,
    },
    swatch: {
      width: 8,
      height: 8,
      borderRadius: 2,
    },
    dropdownText: {
      fontSize: 14,
      fontWeight: '600',
      color: tc.text,
    },
    dropdownTextActive: {
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    sortRow: {
      paddingHorizontal: 18,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      // Four chips overflow a 375pt screen, so wrap instead of clipping.
      flexWrap: 'wrap',
      gap: 7,
    },
    chip: {
      paddingVertical: 7,
      paddingHorizontal: 13,
      borderRadius: 999,
    },
    chipOn: {
      backgroundColor: tc.gold,
    },
    levelChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 11,
      backgroundColor: tc.gold,
    },
    chipOff: {
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    chipTextOn: {
      color: tc.goldDeep,
    },
    chipTextOff: {
      color: tc.textSecondary,
    },
  });

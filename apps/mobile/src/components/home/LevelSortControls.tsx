/**
 * LevelSortControls — the level selector + sort chips beneath the feed
 * header, replacing the old purple `LevelToggle` row (and the now-removed
 * "🎮 Journey · Soon" pill).
 *
 * Layout — one wrapping chip row:
 *   • Sort chips: Rating / Popularity / Level %. Active = chipBgOn/chipTxtOn,
 *     inactive = chipBg/text2 + 1px border. Active chip shows a trailing
 *     ↓ (desc) / ↑ (asc); re-tapping the active sort flips direction.
 *   • Type chip (#114): animation vs live action. Neutral while it reads
 *     "All films" — the default — and gold once a filter is on, so an active
 *     filter is visible without opening it.
 *   • Level chip, last in the row: gold `★ {level} ▾`. Tap → a paper dropdown
 *     where each option is a CEFR colour swatch + label; the active row is
 *     gold-tinted with a check.
 *
 * The level used to sit in a separate label row above the chips
 * (`SHOWING AT YOUR LEVEL` + a gold pill); it now shares the filter row. The
 * row wraps rather than clipping, since the chips overflow narrow phones.
 *
 * Both dropdowns are the same `FilterDropdown` and both anchor to the row's
 * trailing edge, so only one may be open at a time — opening either closes
 * the other.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { HomeIcon } from './HomeIcons';
import { LEVEL_OPTIONS, MOVIE_TYPE_OPTIONS, type MovieType } from './filterOptions';

export type LevelSort = 'rating' | 'popularity' | 'level';

const SORTS: Array<{ key: LevelSort; label: string }> = [
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'level', label: 'Level %' },
];

/** Which dropdown, if any, is open. Only one at a time — they share an anchor. */
type OpenMenu = 'none' | 'level' | 'type';

interface DropdownRow {
  key: string;
  label: string;
  active: boolean;
  /** A CEFR colour chip (level rows) — mutually exclusive with `icon`. */
  swatch?: string;
  /** An emoji glyph (type rows) — mutually exclusive with `swatch`. */
  icon?: string;
}

/** The paper menu both filter chips drop. Extracted rather than duplicated so
 *  a second filter can't drift from the first's dividers/active treatment. */
function FilterDropdown({
  rows,
  onSelect,
  s,
  tc,
}: {
  rows: DropdownRow[];
  onSelect: (key: string) => void;
  s: ReturnType<typeof makeStyles>;
  tc: ThemeColors;
}) {
  return (
    <View style={s.dropdown}>
      {rows.map((row, i) => (
        <TouchableOpacity
          key={row.key}
          style={[
            s.dropdownRow,
            i < rows.length - 1 && s.dropdownRowDivider,
            row.active && s.dropdownRowActive,
          ]}
          onPress={() => onSelect(row.key)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ selected: row.active }}
        >
          {row.swatch ? (
            <View style={[s.swatch, { backgroundColor: row.swatch }]} />
          ) : (
            <Text style={s.dropdownIcon}>{row.icon}</Text>
          )}
          <Text style={[s.dropdownText, row.active && s.dropdownTextActive]}>
            {row.label}
          </Text>
          {row.active ? (
            <View style={{ marginStart: 'auto' }}>
              <HomeIcon name="check" size={15} color={tc.goldOnSurface} sw={2.6} />
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface Props {
  level: string;
  onLevelChange: (level: string) => void;
  sort: LevelSort;
  sortAsc: boolean;
  /** Tap a sort chip: same key flips direction, new key selects it (desc). */
  onSortPress: (key: LevelSort) => void;
  /** Animation vs live action. Defaults to `all` — the pre-#114 feed. */
  movieType?: MovieType;
  onMovieTypeChange?: (type: MovieType) => void;
}

export function LevelSortControls({
  level,
  onLevelChange,
  sort,
  sortAsc,
  onSortPress,
  movieType = 'all',
  onMovieTypeChange,
}: Props) {
  const tc = useThemeColors();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const [openMenu, setOpenMenu] = useState<OpenMenu>('none');

  const typeOption =
    MOVIE_TYPE_OPTIONS.find((o) => o.value === movieType) ?? MOVIE_TYPE_OPTIONS[0];
  const typeFiltered = movieType !== 'all';

  return (
    <View style={s.wrap}>
      {/* Sort chips, then the type + level filter chips */}
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
          style={[s.chip, s.menuChip, typeFiltered ? s.chipOn : s.chipOff]}
          onPress={() => setOpenMenu((v) => (v === 'type' ? 'none' : 'type'))}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('home:filters.type.a11y', {
            value: t(typeOption.labelKey),
          })}
        >
          <Text style={[s.chipText, typeFiltered ? s.chipTextOn : s.chipTextOff]}>
            {t(typeOption.labelKey)}
          </Text>
          <HomeIcon
            name="chevron"
            size={13}
            color={typeFiltered ? tc.goldDeep : tc.textSecondary}
            sw={2.6}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.chip, s.menuChip, s.levelChip]}
          onPress={() => setOpenMenu((v) => (v === 'level' ? 'none' : 'level'))}
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
      {openMenu === 'level' ? (
        <FilterDropdown
          s={s}
          tc={tc}
          rows={LEVEL_OPTIONS.map((opt) => ({
            key: opt.value,
            label: opt.label,
            active: opt.value === level,
            swatch: cefrColors[opt.value] ?? tc.gold,
          }))}
          onSelect={(key) => {
            setOpenMenu('none');
            if (key !== level) onLevelChange(key);
          }}
        />
      ) : null}

      {/* Animation / live action picker */}
      {openMenu === 'type' ? (
        <FilterDropdown
          s={s}
          tc={tc}
          rows={MOVIE_TYPE_OPTIONS.map((opt) => ({
            key: opt.value,
            label: t(opt.labelKey),
            active: opt.value === movieType,
            icon: opt.icon,
          }))}
          onSelect={(key) => {
            setOpenMenu('none');
            if (key !== movieType) onMovieTypeChange?.(key as MovieType);
          }}
        />
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
    dropdownIcon: {
      // Same 8pt column the CEFR swatch occupies, so labels line up whether a
      // row leads with a colour chip or an emoji.
      width: 8,
      fontSize: 13,
      textAlign: 'center',
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
    // Shared by the two chips that drop a menu: label + trailing chevron.
    menuChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 11,
    },
    levelChip: {
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

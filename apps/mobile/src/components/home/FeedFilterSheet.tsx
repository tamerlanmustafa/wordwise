/**
 * FeedFilterSheet — everything that shapes the Home feed *except* the CEFR
 * level: how it's ordered (rating / popularity / level %) and which films are
 * in it (all / animation / live action).
 *
 * Replaces the four chips that used to sit in their own row under the search
 * bar (`LevelSortControls`). They cost a whole row — two rows on a 375pt
 * phone, where they wrapped — to show four controls that are mostly left at
 * their defaults; behind one button they cost nothing until they're wanted.
 * The level is *not* here on purpose: it's the feed's scope rather than a
 * filter, it's seeded from the user's profile rather than from a constant, and
 * it keeps its own always-visible chip in the header (see `HomeHeader`).
 *
 * Selecting an option does NOT close the sheet — unlike the old dropdowns,
 * this is two groups and people change both — so there's an explicit Done.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BottomSheet } from '../common/BottomSheet';
import { SheetOptionRow, SheetSectionLabel } from './SheetOptionRow';
import {
  MOVIE_TYPE_OPTIONS,
  SORT_OPTIONS,
  activeFilterCount,
  type LevelSort,
  type MovieType,
} from './filterOptions';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset?: number;
  sort: LevelSort;
  sortAsc: boolean;
  /** Tap a sort: the same one flips direction, a new one selects it (desc). */
  onSortPress: (key: LevelSort) => void;
  movieType: MovieType;
  onMovieTypeChange: (type: MovieType) => void;
  /** Back to rating ↓ / all films. Only offered when something is off-default. */
  onReset: () => void;
}

export function FeedFilterSheet({
  visible,
  onClose,
  bottomOffset,
  sort,
  sortAsc,
  onSortPress,
  movieType,
  onMovieTypeChange,
  onReset,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const count = activeFilterCount({ sort, sortAsc, movieType });

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <View style={s.titleRow}>
        <Text style={s.title}>{t('home:filters.title')}</Text>
        {count > 0 ? (
          <TouchableOpacity onPress={onReset} activeOpacity={0.6} hitSlop={8}>
            <Text style={s.reset}>{t('home:filters.reset')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <SheetSectionLabel>{t('home:filters.sortLabel')}</SheetSectionLabel>
      {SORT_OPTIONS.map((opt, i) => (
        <SheetOptionRow
          key={opt.value}
          label={t(opt.labelKey)}
          active={opt.value === sort}
          onPress={() => onSortPress(opt.value)}
          // No leading glyph — the empty swatch column keeps these labels
          // aligned with the film-type rows below, which do have one.
          trailing={sortAsc ? '↑' : '↓'}
          divider={i < SORT_OPTIONS.length - 1}
          accessibilityHint={
            opt.value === sort ? t('home:filters.sort.tapToFlip') : undefined
          }
        />
      ))}

      <SheetSectionLabel>{t('home:filters.typeLabel')}</SheetSectionLabel>
      {MOVIE_TYPE_OPTIONS.map((opt, i) => (
        <SheetOptionRow
          key={opt.value}
          label={t(opt.labelKey)}
          active={opt.value === movieType}
          onPress={() => onMovieTypeChange(opt.value)}
          icon={opt.icon}
          divider={i < MOVIE_TYPE_OPTIONS.length - 1}
        />
      ))}

      <TouchableOpacity
        style={s.doneBtn}
        onPress={onClose}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <Text style={s.doneLabel}>{t('home:filters.done')}</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      color: tc.text,
      letterSpacing: -0.2,
    },
    reset: {
      fontSize: 13,
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    doneBtn: {
      marginTop: 16,
      height: 48,
      borderRadius: 13,
      backgroundColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Gold-on-dark text is goldDeep, never white — white fails contrast.
    doneLabel: {
      fontSize: 15,
      fontWeight: '800',
      color: tc.goldDeep,
    },
  });

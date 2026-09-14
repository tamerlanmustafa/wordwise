/**
 * FeedFilterSheet — everything that shapes the Home feed: what it is graded
 * for (the CEFR level), how it's ordered (recommended / rating / popularity /
 * level %) and which films are in it (all / animation / live action).
 *
 * Replaces the four chips that used to sit in their own row under the search
 * bar (`LevelSortControls`), and — since the level moved onto the filter
 * button — the separate `LevelSheet` behind the header chip too. Three groups
 * behind one button cost nothing until they're wanted, where the chips cost a
 * whole row (two on a 375pt phone, where they wrapped) to show controls that
 * are mostly left alone.
 *
 * The level is here but it is **not a filter**: it is the feed's scope, it is
 * seeded from the user's `proficiency_level` rather than from a constant, and
 * so it has no "off" position. That is why Reset says "sort & films" and why
 * `activeFilterCount` never counts it — a count that did would badge the
 * button for every learner whose level isn't `DEFAULT_LEVEL`.
 *
 * Selecting an option does NOT close the sheet — three groups, and people
 * change more than one — so there's an explicit Done. (The old LevelSheet did
 * close on pick; it was one group with one choice.)
 *
 * ## Three grids, no copy
 *
 * Sort and film type used to be full-width rows, under a line explaining that
 * the level is the feed's scope and beside a line saying how often Recommended
 * reshuffles. On an iPhone SE that pushed the sheet 53pt past the top of the
 * screen, taking the title and Reset with it; on a short Android phone with
 * three-button navigation, 102pt. Every group is now the level ladder's shape
 * — cells of one fixed height — so the sheet's height is the sum in
 * `filterSheetMetrics`, and a test holds it against the shortest phones.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BottomSheet } from '../common/BottomSheet';
import { SheetChoiceGrid, SheetSectionLabel } from './SheetChoiceGrid';
import {
  DONE_BUTTON,
  LEVEL_COLUMNS,
  SORT_COLUMNS,
  TITLE_LINE,
  TYPE_COLUMNS,
} from './filterSheetMetrics';
import {
  LEVEL_OPTIONS,
  MOVIE_TYPE_OPTIONS,
  SORT_OPTIONS,
  activeFilterCount,
  sortHasDirection,
  type LevelSort,
  type MovieType,
} from './filterOptions';
import { withTap } from '../../utils/feedback';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset?: number;
  /** The feed's scope, not one of the filters — see the docblock. */
  level: string;
  onLevelChange: (level: string) => void;
  sort: LevelSort;
  sortAsc: boolean;
  /** Tap a sort: the same one flips direction, a new one selects it (desc).
   *  A directionless sort (Recommended) never flips. */
  onSortPress: (key: LevelSort) => void;
  movieType: MovieType;
  onMovieTypeChange: (type: MovieType) => void;
  /** Back to recommended / all films. Leaves the level alone, and is only
   *  offered when something in those two groups is off-default. */
  onReset: () => void;
}

export function FeedFilterSheet({
  visible,
  onClose,
  bottomOffset,
  level,
  onLevelChange,
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

  // The cell prints the code. The prose label ("B1 Intermediate") does not fit
  // a sixth of the sheet, so it is what a screen reader says instead.
  const levelChoices = LEVEL_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.value,
    accessibilityLabel: opt.label,
  }));
  const sortChoices = SORT_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
    // Drawn on the selected cell only. Recommended is a shuffle, so it has no
    // direction to show.
    trailing: sortHasDirection(opt.value) ? (sortAsc ? '↑' : '↓') : undefined,
    accessibilityHint:
      opt.value === sort && sortHasDirection(opt.value)
        ? t('home:filters.sort.tapToFlip')
        : undefined,
  }));
  const typeChoices = MOVIE_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));

  return (
    <BottomSheet visible={visible} onClose={onClose} bottomOffset={bottomOffset}>
      <View style={s.titleRow}>
        <Text style={s.title}>{t('home:filters.title')}</Text>
        {count > 0 ? (
          <TouchableOpacity onPress={withTap(onReset)} activeOpacity={0.6} hitSlop={8}>
            {/* Names the two groups it touches. "Reset" alone, in a sheet that
                now contains the level, would read as a promise to reset that
                too — and the level is the one thing it must not move. */}
            <Text style={s.reset}>{t('home:filters.resetSortAndType')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <SheetSectionLabel>{t('home:level.label')}</SheetSectionLabel>
      <SheetChoiceGrid
        choices={levelChoices}
        selected={level}
        onSelect={onLevelChange}
        columns={LEVEL_COLUMNS}
        mono
      />

      <SheetSectionLabel>{t('home:filters.sortLabel')}</SheetSectionLabel>
      <SheetChoiceGrid
        choices={sortChoices}
        selected={sort}
        onSelect={onSortPress}
        columns={SORT_COLUMNS}
      />

      <SheetSectionLabel>{t('home:filters.typeLabel')}</SheetSectionLabel>
      <SheetChoiceGrid
        choices={typeChoices}
        selected={movieType}
        onSelect={onMovieTypeChange}
        columns={TYPE_COLUMNS}
      />

      <TouchableOpacity
        style={s.doneBtn}
        onPress={withTap(onClose)}
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
      lineHeight: TITLE_LINE,
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
      marginTop: DONE_BUTTON.gap,
      height: DONE_BUTTON.height,
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

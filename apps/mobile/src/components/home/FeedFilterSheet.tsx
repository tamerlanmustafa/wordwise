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
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { BottomSheet } from '../common/BottomSheet';
import { SheetOptionRow, SheetSectionLabel } from './SheetOptionRow';
import {
  LEVEL_OPTIONS,
  MOVIE_TYPE_OPTIONS,
  RECOMMENDED_ROTATION_HOURS,
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
      <Text style={s.caption}>{t('home:level.scopeNote')}</Text>
      {/* A ladder, not six rows: six SheetOptionRows are 288pt, and a CEFR
          level is a scale — six cells side by side say that, a menu does not.
          `flexDirection: 'row'` mirrors under RTL along with everything else,
          so A1 stays on the leading edge. */}
      <View style={s.ladder} accessibilityRole="radiogroup">
        {LEVEL_OPTIONS.map((opt) => {
          const active = opt.value === level;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.rung, active && s.rungOn]}
              onPress={withTap(() => onLevelChange(opt.value))}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              // The prose label ("B1 Intermediate") does not fit a 52pt cell,
              // so it lives here — the cell prints the code alone.
              accessibilityLabel={opt.label}
            >
              <Text style={[s.rungLabel, active && s.rungLabelOn]}>{opt.value}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SheetSectionLabel>{t('home:filters.sortLabel')}</SheetSectionLabel>
      {SORT_OPTIONS.map((opt, i) => (
        <SheetOptionRow
          key={opt.value}
          label={t(opt.labelKey)}
          active={opt.value === sort}
          onPress={withTap(() => onSortPress(opt.value))}
          // No leading glyph — the empty swatch column keeps these labels
          // aligned with the film-type rows below, which do have one.
          trailing={
            sortHasDirection(opt.value) ? (sortAsc ? '↑' : '↓') : undefined
          }
          note={
            opt.value === 'recommended'
              ? t('home:filters.sort.recommendedNote', {
                  hours: RECOMMENDED_ROTATION_HOURS,
                })
              : undefined
          }
          divider={i < SORT_OPTIONS.length - 1}
          accessibilityHint={
            opt.value === sort && sortHasDirection(opt.value)
              ? t('home:filters.sort.tapToFlip')
              : undefined
          }
        />
      ))}

      <SheetSectionLabel>{t('home:filters.typeLabel')}</SheetSectionLabel>
      {MOVIE_TYPE_OPTIONS.map((opt, i) => (
        <SheetOptionRow
          key={opt.value}
          label={t(opt.labelKey)}
          active={opt.value === movieType}
          onPress={withTap(() => onMovieTypeChange(opt.value))}
          icon={opt.icon}
          divider={i < MOVIE_TYPE_OPTIONS.length - 1}
        />
      ))}

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
      fontWeight: '800',
      color: tc.text,
      letterSpacing: -0.2,
    },
    reset: {
      fontSize: 13,
      fontWeight: '800',
      color: tc.goldOnSurface,
    },
    caption: {
      fontSize: 11.5,
      lineHeight: 16,
      color: tc.textSecondary,
      paddingHorizontal: 12,
      marginBottom: 8,
    },
    ladder: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
    },
    rung: {
      flex: 1,
      height: 44,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rungOn: {
      backgroundColor: tc.gold,
      borderColor: tc.gold,
    },
    rungLabel: {
      fontFamily: MONO_FAMILY,
      fontSize: 12.5,
      fontWeight: '700',
      color: tc.textSecondary,
    },
    rungLabelOn: {
      color: tc.goldDeep,
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

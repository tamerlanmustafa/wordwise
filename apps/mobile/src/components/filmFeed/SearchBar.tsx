/**
 * SearchBar — the cinema search field for the redesigned Home.
 *
 * Replaces the old purple 🔍 search button + plain input. Presentational:
 * all state (query, focus, suggestions, recently-viewed) and handlers live
 * in FilmFeedScreen, so the data wiring is unchanged — only the skin differs.
 *
 *   • paper field, radius 12, height 48, 1px border that turns gold on
 *     focus, soft shadowCard. Leading stroked search glyph. Gold caret
 *     (native, via selectionColor). Trailing stroked ✕ clear icon when
 *     there's a query.
 *   • Autocomplete dropdown: paper, radius 12, 1px border, big soft shadow.
 *     Each row = 40×60 poster + serif title + year. No footer — the panel is
 *     the whole of search now; there is no results page behind it.
 *   • Recently-viewed dropdown reuses the same row treatment.
 *   • A 64pt filter button on the trailing edge, opening `FeedFilterSheet` —
 *     the same "wide control + square button" pairing the Lists tab uses for
 *     its sort sheet. Neutral at defaults, gold with a count once something is
 *     filtered, so hidden state stays visible.
 *
 * That button also prints the CEFR level the feed is graded for. The level
 * used to have a 46pt header row of its own holding one gold chip; the chip
 * deserves to be permanently on screen (it is the feed's *scope*), the row did
 * not. It is not part of the filter count — see `activeFilterCount`.
 *
 * The field shrinks to make room for the button, but the dropdown stays
 * anchored to the full-width wrapper — narrowing it by 72pt would crop the
 * poster rows for no reason.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { MONO_FAMILY } from '../../theme/fonts';
import { HomeIcon } from './FilmFeedIcons';
import { FocusGlow } from './FocusGlow';
import { feedback, withTap } from '../../utils/feedback';

/** The field's corner radius, shared with the glow ring so the two agree. */
const FIELD_RADIUS = 12;

/** How many recent films the panel offers. Three, not five: this is a
 *  shortcut back to something you just looked at, and past the third row it
 *  stops being a shortcut and starts being a list to read. */
const RECENT_LIMIT = 3;

const SERIF_FAMILY = 'Source Serif 4';

interface Props {
  query: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  /** The autocomplete rows. Capped by the caller — see SUGGESTION_LIMIT. */
  suggestions: any[];
  showSuggestions: boolean;
  recentlyViewed: any[];
  onMoviePress: (movie: any) => void;
  /** Opens FeedFilterSheet. Omit to hide the button entirely. */
  onFilterPress?: () => void;
  /** Closes the search. While the field is focused the filter button calls
   *  this instead of opening the sheet — see the button below. */
  onDismiss?: () => void;
  /** How many filter groups are off-default — badge count, and gold when > 0. */
  activeFilters?: number;
  /** CEFR code the whole feed is graded for, printed on the filter button. */
  level: string;
  /** Whether FeedFilterSheet is showing. Drives the button's own focus
   *  treatment, so the two controls in this row behave the same way. */
  filtersOpen?: boolean;
}

function Row({
  movie,
  tc,
  s,
  onPress,
}: {
  movie: any;
  tc: ThemeColors;
  s: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={s.row} onPress={withTap(onPress)} activeOpacity={0.7}>
      {movie.poster_path ? (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w92${movie.poster_path}` }}
          style={s.rowPoster}
        />
      ) : (
        <View style={[s.rowPoster, { backgroundColor: tc.border }]} />
      )}
      <View style={s.rowInfo}>
        <Text style={s.rowTitle} numberOfLines={1}>{movie.title}</Text>
        <Text style={s.rowYear}>{movie.release_date?.slice(0, 4)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function SearchBar({
  query,
  onChangeText,
  onSubmit,
  onClear,
  focused,
  onFocus,
  onBlur,
  suggestions,
  showSuggestions,
  recentlyViewed,
  onMoviePress,
  onFilterPress,
  onDismiss,
  activeFilters = 0,
  level,
  filtersOpen = false,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // A short lift on focus, not a pulse: the field settles at rest, so the
  // motion says "this is now the thing you are typing into" and then stops.
  // Scale is a native-driver transform, so it runs off the JS thread while the
  // keyboard animates in — the one moment the JS thread is busiest.
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(lift, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      friction: 5,
      tension: 180,
    }).start();
  }, [focused, lift]);

  // The tap-back, fired on the focus *transition* rather than from an onPress.
  // There are two ways into this field — a tap on the input itself, and a tap
  // anywhere else inside the border — and hanging the haptic off one of them
  // would make half the taps feel different from the other half.
  //
  // Through `utils/feedback` rather than the native module directly: that file
  // is the single owner of both channels and of the policy behind them (the
  // user's two switches, missing hardware, the silent switch), and a source
  // guard fails the build on a second importer.
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) feedback.tap();
    wasFocused.current = focused;
  }, [focused]);

  // Anywhere inside the border focuses the field. The magnifier, the gap
  // beside it and the padding at the far end were all dead: they look like
  // part of the control and sit inside its border, but only the input itself —
  // a slice of the middle — actually took a tap.
  const inputRef = useRef<TextInput>(null);
  const focusField = () => inputRef.current?.focus();
  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] });

  // The filter button wears the identical treatment, driven by its own sheet.
  // Two controls side by side that announce activation differently look like
  // two controls from two apps.
  const filterLift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(filterLift, {
      toValue: filtersOpen ? 1 : 0,
      useNativeDriver: true,
      friction: 5,
      tension: 180,
    }).start();
  }, [filtersOpen, filterLift]);
  const filterScale = filterLift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] });

  const wasFiltersOpen = useRef(filtersOpen);
  useEffect(() => {
    if (filtersOpen && !wasFiltersOpen.current) feedback.tap();
    wasFiltersOpen.current = filtersOpen;
  }, [filtersOpen]);

  const showAutocomplete = showSuggestions && suggestions.length > 0;
  const showRecent = focused && !query && recentlyViewed.length > 0;
  const filtered = activeFilters > 0;

  return (
    <View style={s.wrap}>
      <View style={s.fieldWrap}>
        <View style={s.fieldRow}>
          <Animated.View style={[s.fieldStack, { transform: [{ scale }] }]}>
            {/* Under the field, so the field's own background clips it to a
                rim. See FocusGlow. */}
            <FocusGlow active={focused} radius={FIELD_RADIUS} />
            <Pressable
              style={[s.field, { borderColor: focused ? tc.gold : tc.border }]}
              onPress={withTap(focusField)}
              accessible={false}
            >
            <HomeIcon name="search" size={18} color={tc.textFaint} sw={2.2} />
            <TextInput
              ref={inputRef}
              style={s.input}
              placeholder={t('home:search.placeholder')}
              placeholderTextColor={tc.textFaint}
              value={query}
              onChangeText={onChangeText}
              onFocus={onFocus}
              onBlur={onBlur}
              onSubmitEditing={onSubmit}
              returnKeyType="search"
              selectionColor={tc.gold}
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={withTap(onClear)} hitSlop={8} style={s.clearBtn}>
                <HomeIcon name="close" size={16} color={tc.textFaint} sw={2.4} />
              </TouchableOpacity>
            ) : null}
            </Pressable>
          </Animated.View>

          {onFilterPress ? (
            <Animated.View style={[s.filterStack, { transform: [{ scale: filterScale }] }]}>
            <FocusGlow active={filtersOpen} radius={FIELD_RADIUS} />
            <TouchableOpacity
              // Dimmed with the rest of the screen while searching, and not
              // reachable: opening a sheet from under the search panel is
              // never what the tap meant. It dismisses instead of doing
              // nothing, because a button that looks present and answers to
              // nothing is the dead zone this control just got rid of.
              style={[s.filterBtn, filtered && s.filterBtnOn, focused && s.filterBtnDimmed]}
              onPress={withTap(focused ? onDismiss ?? onFilterPress : onFilterPress)}
              activeOpacity={0.8}
              accessibilityRole="button"
              // One label for one button. It now does two jobs — it says what
              // the feed is scoped to and it opens the filters — and a screen
              // reader that announced only "Filters" would leave the level
              // unreadable anywhere in the app.
              accessibilityLabel={t('home:filters.a11yWithLevel', {
                level,
                count: activeFilters,
              })}
            >
              <Text style={[s.levelCode, filtered && s.levelCodeOn]}>{level}</Text>
              <HomeIcon
                name="filter"
                size={19}
                color={filtered ? tc.goldDeep : tc.textSecondary}
                sw={2.1}
              />
              {filtered ? (
                <View style={s.badge}>
                  <Text style={s.badgeText}>{activeFilters}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            </Animated.View>
          ) : null}
        </View>

        {showAutocomplete ? (
          <View style={[s.dropdown, onFilterPress ? s.dropdownInset : null]}>
            {suggestions.map((movie: any) => (
              <Row
                key={movie.id}
                movie={movie}
                tc={tc}
                s={s}
                onPress={withTap(() => onMoviePress(movie))}
              />
            ))}
          </View>
        ) : showRecent ? (
          <View style={[s.dropdown, onFilterPress ? s.dropdownInset : null]}>
            <Text style={s.recentLabel}>{t('home:search.recentlyViewed')}</Text>
            {recentlyViewed.slice(0, RECENT_LIMIT).map((movie: any) => (
              <Row
                key={movie.id}
                movie={movie}
                tc={tc}
                s={s}
                onPress={withTap(() => onMoviePress(movie))}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      paddingHorizontal: 18,
      // The search row is the screen's first child now that the level's header
      // row is gone, so it carries the small breath that row used to give it.
      paddingTop: 6,
      paddingBottom: 12,
    },
    fieldWrap: {
      position: 'relative',
      zIndex: 100,
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    // The field and its glow ring share a stacking context. `flex: 1` moved
    // here from the field so the ring measures the same box the field fills.
    fieldStack: {
      flex: 1,
      minWidth: 0,
    },
    field: {
      height: 48,
      borderRadius: FIELD_RADIUS,
      borderWidth: 1,
      backgroundColor: tc.paper,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    input: {
      flex: 1,
      fontSize: 15,
      color: tc.text,
      padding: 0,
    },
    clearBtn: {
      padding: 2,
    },
    // Wraps the button with its glow ring, the same pairing the field has.
    filterStack: {
      width: 64,
    },
    // Same 48pt height as the field so the two read as one control pair — the
    // treatment ListDetailScreen uses for its sort button. 64 wide rather than
    // square, because it carries the CEFR code as well as the glyph.
    filterBtn: {
      width: 64,
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    filterBtnOn: {
      backgroundColor: tc.gold,
      borderColor: tc.gold,
    },
    // Matches the overlay over everything else on screen, so the button reads
    // as part of the dimmed background rather than as the one live control
    // beside the field.
    filterBtnDimmed: {
      opacity: 0.35,
    },
    // Mono, so B1 and C2 are the same width and the glyph never shifts.
    levelCode: {
      fontFamily: MONO_FAMILY,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: -0.2,
      color: tc.goldOnSurface,
    },
    // On the gold fill, goldOnSurface would sit on its own colour.
    levelCodeOn: {
      color: tc.goldDeep,
    },
    badge: {
      position: 'absolute',
      top: 5,
      end: 5,
      minWidth: 15,
      height: 15,
      borderRadius: 8,
      paddingHorizontal: 3,
      backgroundColor: tc.goldDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontSize: 9.5,
      fontWeight: '900',
      color: tc.gold,
    },
    dropdown: {
      position: 'absolute',
      // Sits just below the 48px field (no calc() in RN).
      top: 54,
      left: 0,
      right: 0,
      backgroundColor: tc.paper,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tc.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: 18 },
      elevation: 14,
    },
    // Aligned to the field rather than to the wrapper. The panel used to span
    // the full width, including the 64pt filter button beside the field, so it
    // hung off the end of the control it belongs to. 72 = the button's 64 plus
    // the 8pt gap; the poster rows have ~285pt left at that width, which is
    // ample for a 40pt poster and a title.
    dropdownInset: {
      end: 72,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderBottomWidth: 1,
      borderBottomColor: tc.divider,
    },
    rowPoster: {
      width: 40,
      height: 60,
      borderRadius: 5,
      backgroundColor: tc.border,
    },
    rowInfo: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      fontFamily: SERIF_FAMILY,
      fontSize: 15,
      fontWeight: '600',
      color: tc.text,
      letterSpacing: -0.2,
    },
    rowYear: {
      fontSize: 12,
      color: tc.textFaint,
      marginTop: 2,
      fontWeight: '600',
    },
    seeAll: {
      paddingVertical: 11,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    seeAllText: {
      fontSize: 12,
      fontWeight: '900',
      color: tc.goldOnSurface,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    recentLabel: {
      fontSize: 11,
      fontWeight: '800',
      color: tc.textFaint,
      letterSpacing: 0.5,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 4,
      textTransform: 'uppercase',
    },
  });

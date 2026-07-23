/**
 * HomeSearchBar — the cinema search field for the redesigned Home.
 *
 * Replaces the old purple 🔍 search button + plain input. Presentational:
 * all state (query, focus, suggestions, recently-viewed) and handlers live
 * in HomeScreen, so the data wiring is unchanged — only the skin differs.
 *
 *   • paper field, radius 12, height 48, 1px border that turns gold on
 *     focus, soft shadowCard. Leading stroked search glyph. Gold caret
 *     (native, via selectionColor). Trailing stroked ✕ clear icon when
 *     there's a query.
 *   • Autocomplete dropdown: paper, radius 12, 1px border, big soft shadow.
 *     Each row = 40×60 poster + serif title + year. Footer
 *     `SEE ALL {n} RESULTS` in goldOnSurface.
 *   • Recently-viewed dropdown reuses the same row treatment.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';

const SERIF_FAMILY = 'Source Serif 4';

interface Props {
  query: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  /** Up-to-5 autocomplete rows. */
  suggestions: any[];
  /** Total results (drives the "SEE ALL {n}" footer; footer shows when > 5). */
  allResultsCount: number;
  showSuggestions: boolean;
  recentlyViewed: any[];
  onMoviePress: (movie: any) => void;
  onSeeAll: () => void;
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
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
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

export function HomeSearchBar({
  query,
  onChangeText,
  onSubmit,
  onClear,
  focused,
  onFocus,
  onBlur,
  suggestions,
  allResultsCount,
  showSuggestions,
  recentlyViewed,
  onMoviePress,
  onSeeAll,
}: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const showAutocomplete = showSuggestions && suggestions.length > 0;
  const showRecent = focused && !query && recentlyViewed.length > 0;

  return (
    <View style={s.wrap}>
      <View style={s.fieldWrap}>
        <View style={[s.field, { borderColor: focused ? tc.gold : tc.border }]}>
          <HomeIcon name="search" size={18} color={tc.textFaint} sw={2.2} />
          <TextInput
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
            <TouchableOpacity onPress={onClear} hitSlop={8} style={s.clearBtn}>
              <HomeIcon name="close" size={16} color={tc.textFaint} sw={2.4} />
            </TouchableOpacity>
          ) : null}
        </View>

        {showAutocomplete ? (
          <View style={s.dropdown}>
            {suggestions.map((movie: any) => (
              <Row
                key={movie.id}
                movie={movie}
                tc={tc}
                s={s}
                onPress={() => onMoviePress(movie)}
              />
            ))}
            {allResultsCount > 5 ? (
              <TouchableOpacity style={s.seeAll} onPress={onSeeAll} activeOpacity={0.7}>
                <Text style={s.seeAllText}>SEE ALL {allResultsCount} RESULTS</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : showRecent ? (
          <View style={s.dropdown}>
            <Text style={s.recentLabel}>{t('home:search.recentlyViewed')}</Text>
            {recentlyViewed.slice(0, 5).map((movie: any) => (
              <Row
                key={movie.id}
                movie={movie}
                tc={tc}
                s={s}
                onPress={() => onMoviePress(movie)}
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
      paddingBottom: 12,
    },
    fieldWrap: {
      position: 'relative',
      zIndex: 100,
    },
    field: {
      height: 48,
      borderRadius: 12,
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

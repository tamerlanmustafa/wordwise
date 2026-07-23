/**
 * SortPill — v0.7 My Movies sort selector.
 *
 * Compact pill showing the current sort label + a small ▼ glyph. Tap →
 * native ActionSheet (iOS) or modal-style sheet (Android via the same
 * imperative API in expo). Selected sort persists via myMoviesStore.
 *
 * Spec from `tabs/my-movies.jsx`: padding 5×10, radius 8, bg
 * `tc.chipBg`, 1px `tc.border`, label 12px weight 800 `tc.textSecondary`.
 */

import { ActionSheetIOS, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useTranslation } from 'react-i18next';
import {
  SORT_LABELS,
  SORT_ORDER,
  type MyMoviesSort,
} from '../../stores/myMoviesStore';

export interface SortPillProps {
  value: MyMoviesSort;
  onChange: (s: MyMoviesSort) => void;
  /** Optional summary line shown to the left of the pill (e.g.
   *  "10 films · sorted by"). Wrapped here so callers don't need to
   *  re-implement the typography. */
  summary?: string;
}

export function SortPill({ value, onChange, summary }: SortPillProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = makeStyles(tc);

  const labels = SORT_ORDER.map((k) => SORT_LABELS[k]);

  const open = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, t('action.cancel')],
          cancelButtonIndex: labels.length,
          title: t('movies:myMovies.sortBy'),
        },
        (idx) => {
          if (idx >= 0 && idx < SORT_ORDER.length) onChange(SORT_ORDER[idx]);
        },
      );
      return;
    }
    // Android fallback — cycle to the next sort. Cheaper than building
    // a custom modal for parity, and the iOS path is the primary
    // target for the design canvas. A proper Android modal is on the
    // follow-up list.
    const i = SORT_ORDER.indexOf(value);
    const next = SORT_ORDER[(i + 1) % SORT_ORDER.length];
    onChange(next);
  };

  return (
    <View style={s.row}>
      {summary ? (
        <Text style={s.summary} numberOfLines={1}>
          {summary}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <Pressable
        onPress={open}
        style={({ pressed }) => [s.pill, pressed && { opacity: 0.85 }]}
        hitSlop={6}
      >
        <Text style={s.pillLabel} numberOfLines={1}>
          {SORT_LABELS[value]}
        </Text>
        <Text style={s.pillChevron}>▼</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingBottom: 10,
      gap: 12,
    },
    summary: {
      flex: 1,
      fontSize: 11,
      fontWeight: '800',
      color: tc.textFaint,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
    },
    pillLabel: {
      fontSize: 12,
      fontWeight: '800',
      color: tc.textSecondary,
    },
    pillChevron: {
      fontSize: 9,
      color: tc.textFaint,
    },
  });

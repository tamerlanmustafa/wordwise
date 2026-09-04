/**
 * ScreenHeader — the back-arrow bar every pushed screen wears.
 *
 * It existed six times before this file did, once per screen, and they had
 * drifted: Stats/Leaderboard/Achievements set a 16pt/700 title, Settings and
 * Admin set 18pt/600; the back link was `primaryOnSurface` in three places,
 * `primary` in another, and a frozen purple hex in Achievements. Nothing was
 * broken — every copy rendered a perfectly good header, just not the same one,
 * which is exactly the kind of difference you notice only by walking between
 * two screens.
 *
 * The accent is **gold**, not purple. Purple is the app's older `primary`
 * token and survives in a few places, but every surface a learner actually
 * spends time in — Home, Explore, Practice — is gold, so a purple back link
 * reads as belonging to a different app.
 *
 * The trailing slot is a fixed 60pt whether or not anything is in it, matching
 * the leading link's width, so the title stays optically centred instead of
 * shifting when a screen adds a refresh button.
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BACK_ARROW } from '../../i18n/rtl';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

/** Both side slots reserve this, so the title sits centred. */
export const HEADER_SIDE_WIDTH = 60;

interface Props {
  onBack: () => void;
  /** What the back link names — the screen you came *from*. Falls back to a
   *  plain "Back" when the caller has nothing more specific. */
  backLabel?: string;
  title: string;
  /** Optional trailing control (refresh, filter…). The slot is reserved
   *  either way so adding one never moves the title. */
  right?: ReactNode;
}

export function ScreenHeader({ onBack, backLabel, title, right }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack} hitSlop={8} style={s.side} accessibilityRole="button">
        <Text style={s.backText} numberOfLines={1}>
          {BACK_ARROW} {backLabel ?? t('action.back')}
        </Text>
      </TouchableOpacity>

      <Text style={s.title} numberOfLines={1}>
        {title}
      </Text>

      <View style={[s.side, s.rightSlot]}>{right}</View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: tc.paper,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tc.border,
    },
    side: {
      width: HEADER_SIDE_WIDTH,
    },
    rightSlot: {
      alignItems: 'flex-end',
    },
    backText: {
      fontSize: 16,
      fontWeight: '500',
      color: tc.goldOnSurface,
    },
    title: {
      flex: 1,
      minWidth: 0,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '700',
      color: tc.text,
    },
  });

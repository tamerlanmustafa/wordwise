/**
 * HomeHeader — the top row of the redesigned Home screen.
 *
 * A circular notification button, right-aligned, carrying a small gold unread
 * dot. The `YOUR FEED · {level} LEVEL` eyebrow that used to sit on the left is
 * gone — the level now lives on the filter row (see `LevelSortControls`), so
 * the row is just the bell. No emoji — the bell is a stroked icon.
 */

import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';

interface Props {
  /** Whether to show the gold unread dot on the bell. */
  hasUnread?: boolean;
  /** Tap handler for the notification button. */
  onNotificationsPress?: () => void;
}

export function HomeHeader({ hasUnread = false, onNotificationsPress }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.header}>
      <TouchableOpacity
        style={s.bellBtn}
        onPress={onNotificationsPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('home:notifications')}
      >
        <HomeIcon name="bell" size={16} color={tc.textSecondary} />
        {hasUnread ? <View style={s.unreadDot} /> : null}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      // Bell only — `flex-end` follows the writing direction, so it stays on
      // the trailing edge under RTL too.
      justifyContent: 'flex-end',
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 12,
    },
    bellBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    unreadDot: {
      position: 'absolute',
      top: 7,
      end: 9,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: tc.gold,
      borderWidth: 1.5,
      borderColor: tc.background,
    },
  });

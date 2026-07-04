/**
 * HomeHeader — the top row of the redesigned Home screen.
 *
 * Eyebrow `YOUR FEED · {level} LEVEL` (gold, 10/900) with a circular
 * notification button on the right carrying a small gold unread dot. The
 * eyebrow matches the My Movies / Practice headers (10/900 ls 2
 * goldOnSurface). No emoji — the bell is a stroked icon.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';

interface Props {
  /** User CEFR level, shown in the eyebrow. */
  level: string;
  /** Whether to show the gold unread dot on the bell. */
  hasUnread?: boolean;
  /** Tap handler for the notification button. */
  onNotificationsPress?: () => void;
}

export function HomeHeader({ level, hasUnread = false, onNotificationsPress }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={s.eyebrow}>YOUR FEED · {level} LEVEL</Text>
      </View>
      <TouchableOpacity
        style={s.bellBtn}
        onPress={onNotificationsPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Notifications"
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
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 12,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
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
      right: 9,
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: tc.gold,
      borderWidth: 1.5,
      borderColor: tc.background,
    },
  });

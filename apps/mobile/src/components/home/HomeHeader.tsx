/**
 * HomeHeader — the top row of Home: the gold CEFR level chip, and nothing else.
 *
 * This row used to hold the notification bell (and before that a `YOUR FEED ·
 * {level} LEVEL` eyebrow). The bell moved into the profile sheet, which freed
 * the row for the thing that most deserves to be permanently on screen: the
 * level the whole feed is graded for. It sits on the *leading* edge, where a
 * title goes — the trailing corner is action/avatar territory on both
 * platforms, and a scope label is not an action.
 *
 * Tapping opens `LevelSheet`; HomeScreen owns that state, because a sheet
 * rendered inside this 46pt row would be clipped to it.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { HomeIcon } from './HomeIcons';

interface Props {
  /** CEFR code the feed is currently showing, e.g. `B1`. */
  level: string;
  onLevelPress: () => void;
}

export function HomeHeader({ level, onLevelPress }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.header}>
      <TouchableOpacity
        style={s.levelChip}
        onPress={onLevelPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('home:level.a11y', { value: level })}
      >
        <HomeIcon name="star" size={13} color={tc.goldDeep} />
        <Text style={s.levelText}>{level}</Text>
        <HomeIcon name="chevron" size={14} color={tc.goldDeep} sw={2.6} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      // `flex-start` follows the writing direction, so the chip stays on the
      // leading edge under RTL too.
      justifyContent: 'flex-start',
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 10,
    },
    levelChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: tc.gold,
    },
    levelText: {
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 0.2,
      color: tc.goldDeep,
    },
  });

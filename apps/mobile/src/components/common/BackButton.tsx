/**
 * BackButton — the one back control in the app.
 *
 * There were three shapes before this file. The film detail hero had a
 * circular chevron chip; Settings, Admin and the rest rendered `← Back` (or
 * `← Profile`, or `← Admin`) as text through ScreenHeader; Lists drew a circle
 * with a text arrow glyph in it. Three affordances for one action, and the
 * text ones additionally changed width with the label and with the locale.
 *
 * The chip won because it is the one that already reads as a button rather
 * than as a link, it is a fixed size in every language, and it is what the
 * most-visited pushed screen in the app already used.
 *
 * Direction is not hard-coded: `directionalIcon` flips the chevron under RTL,
 * where "back" points the other way.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { directionalIcon } from '../../i18n/rtl';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

/** Outer diameter. Exported so a header can reserve exactly this much on the
 *  trailing side and keep its title optically centred. */
export const BACK_BUTTON_SIZE = 34;

export function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('action.back')}
      // The chip is 34pt; the slop brings the target to the 44pt both
      // platforms ask for without making the circle look heavy.
      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
      style={({ pressed }) => [s.btn, pressed && s.pressed]}
    >
      <Ionicons name={directionalIcon('chevron-back')} size={18} color={tc.textSecondary} />
    </Pressable>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    btn: {
      width: BACK_BUTTON_SIZE,
      height: BACK_BUTTON_SIZE,
      borderRadius: BACK_BUTTON_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tc.chipBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tc.border,
    },
    pressed: {
      opacity: 0.7,
    },
  });

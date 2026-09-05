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
 * The back control is `BackButton` — the circular chevron chip the film detail
 * screen already used. It replaced a text link that named the previous screen
 * ("← Profile", "← Admin"), which changed width with the label and the locale
 * and read as a link rather than a button.
 *
 * The trailing slot is a fixed 60pt whether or not anything is in it, matching
 * the leading link's width, so the title stays optically centred instead of
 * shifting when a screen adds a refresh button.
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { BackButton } from './BackButton';

/** Both side slots reserve this, so the title sits centred. */
export const HEADER_SIDE_WIDTH = 44;

interface Props {
  onBack: () => void;
  /** Accepted so callers can keep passing it, but no longer rendered: the back
   *  control is an icon chip of fixed size, the same one the film detail screen
   *  uses. A text label changed width with the locale and read as a link
   *  rather than a button. */
  backLabel?: string;
  title: string;
  /** Optional trailing control (refresh, filter…). The slot is reserved
   *  either way so adding one never moves the title. */
  right?: ReactNode;
}

export function ScreenHeader({ onBack, title, right }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.header}>
      <View style={s.side}>
        <BackButton onPress={onBack} />
      </View>

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
      paddingVertical: 10,
      // Transparent, so the header is part of the page rather than a bar laid
      // over it — and so Profile (which has no back button) and its sub-pages
      // read as one surface when you move between them.
      backgroundColor: 'transparent',
    },
    side: {
      width: HEADER_SIDE_WIDTH,
    },
    rightSlot: {
      alignItems: 'flex-end',
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

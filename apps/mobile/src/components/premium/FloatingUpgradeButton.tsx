/**
 * FloatingUpgradeButton — the "Upgrade to Plus" pill that floats over a tab.
 *
 * Built ahead of being placed (2026-09-15): which tabs carry it is still to be
 * decided, so it is made to drop into any screen root as-is.
 *
 * - **It opens the upgrade sheet, never a screen.** It calls
 *   `openPremiumSheet`, the one place the app asks someone to subscribe (see
 *   `premiumSheetStore`), so the tab behind it stays where it was and
 *   dismissing puts the reader straight back.
 * - **It shows only to accounts known to be free.** An invitation to buy what
 *   you already have reads as a billing bug. `useIsPremium` is the wrong hook
 *   for that: it is a gate, and gates fail closed, so a tier the server has not
 *   reported yet counts as free — every cold start would flash the pitch at a
 *   paying member until `/auth/me` answered. `useEntitlements` keeps "not
 *   known" apart from "free". Both honour the admin view-mode preview.
 * - **It floats above the tab bar.** The bar is an absolute overlay drawn over
 *   every screen, so the default position reserves the bar's own height
 *   (`useBottomBarInset`) plus a gap. `style` moves it somewhere else.
 * - **It is a pill, like the app's other buttons:** a gold face over a darker
 *   gold edge (`ui/PressablePill`), the word deck's Next button at a smaller
 *   size. Its soft shadow uses iOS properties only and sits on the edge layer;
 *   on Android an elevated edge draws over its own face, and the hard edge is
 *   the depth cue there anyway.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColorScheme, useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { useEntitlements } from '../../stores/entitlementsStore';
import { openPremiumSheet } from '../../stores/premiumSheetStore';
import { withTap } from '../../utils/feedback';
import { PressablePill } from '../ui/PressablePill';
import { SparkleIcon } from '../ui/icons';
import type { PaywallReason } from '../paywallPricing';

/** Height of the face. Above both platforms' minimum tap target. */
export const UPGRADE_FAB_HEIGHT = 48;
/** Clear space between the button and the tab bar's reserved area. */
export const UPGRADE_FAB_GAP = 12;
/** Inset from the screen's trailing edge. */
export const UPGRADE_FAB_SIDE = 16;

interface Props {
  /** Why the sheet opens, which picks its subtitle. Omit for the generic pitch. */
  reason?: PaywallReason;
  /** Replaces the default position: the trailing corner, above the tab bar. */
  style?: StyleProp<ViewStyle>;
}

export function FloatingUpgradeButton({ reason = null, style }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);
  const entitlements = useEntitlements();
  const barInset = useBottomBarInset();

  if (!entitlements || entitlements.is_premium) return null;

  const label = t('settings:upgradeToPlus');
  // The Next pill's ink: white on the light theme's deeper gold, the dark ink
  // on the dark theme's pale gold, where white would be unreadable.
  const ink = scheme === 'light' ? '#FFFFFF' : tc.goldDeep;

  return (
    <View
      // box-none, so the corner around the pill still reaches the screen below.
      pointerEvents="box-none"
      style={[s.anchor, { bottom: barInset + UPGRADE_FAB_GAP }, style]}
    >
      <PressablePill
        edge={tc.nodeGoldEdge}
        radius={UPGRADE_FAB_HEIGHT / 2}
        faceStyle={s.face}
        shadow={s.shadow}
        onPress={withTap(() => openPremiumSheet(reason))}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <SparkleIcon size={15} color={ink} />
        <Text style={[s.label, { color: ink }]} numberOfLines={1}>
          {label}
        </Text>
      </PressablePill>
    </View>
  );
}

const makeStyles = (tc: ThemeColors, scheme: 'light' | 'dark') =>
  StyleSheet.create({
    anchor: {
      position: 'absolute',
      end: UPGRADE_FAB_SIDE,
    },
    face: {
      height: UPGRADE_FAB_HEIGHT,
      borderRadius: UPGRADE_FAB_HEIGHT / 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 18,
      backgroundColor: tc.gold,
      // The Next pill's rim, in the colour of the edge it sits on, so a solid
      // gold button does not dissolve into the paper on a light ground.
      borderWidth: 1.5,
      borderColor: tc.nodeGoldEdge,
    },
    // iOS shadow properties only — see the docblock.
    shadow: {
      shadowColor: '#000',
      shadowOpacity: scheme === 'dark' ? 0.4 : 0.16,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
    },
    label: {
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.2,
    },
  });

/**
 * UpgradeButton — the gold crown square in the top-right corner of a tab.
 *
 * Placed 2026-09-15, by request, in one corner everywhere: beside the filter
 * button on Explore, beside the streak panel on Practice, beside the + on
 * Lists, over the word card on Home, and on a film's backdrop. The corner is
 * the point. Someone who has found it once knows where it is on every tab.
 *
 * - **The filter button's box.** `HEADER_CONTROL` is the size and corner the
 *   Explore search row is built on, so the crown sits in that row as a sibling
 *   and is the same square everywhere else. Square where the filter button is
 *   64 wide, because that one also prints a level.
 * - **It opens the upgrade sheet, never a screen.** `openPremiumSheet` leaves
 *   the tab behind it exactly where it was (see `premiumSheetStore`).
 * - **It shows only to accounts known to be free.** An invitation to buy what
 *   you already pay for reads as a billing bug. `useIsPremium` is the wrong
 *   hook here: it is a gate, and gates fail closed, so a tier the server has
 *   not reported counts as free. `useEntitlements` keeps "not known" apart
 *   from "free". Both honour the admin view-mode preview, so Admin Panel →
 *   View mode → Free shows it for QA.
 * - **A row with an open panel can dim it.** The Explore search row paints
 *   above its own sheet's scrim, so `dimmed` and `onDismiss` let the crown join
 *   the background there and close the panel on a tap, as the filter button
 *   beside it does.
 */

import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColorScheme, useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useEntitlements } from '../../stores/entitlementsStore';
import { openPremiumSheet } from '../../stores/premiumSheetStore';
import { withTap } from '../../utils/feedback';
import { CrownIcon } from '../ui/icons';
import { HEADER_CONTROL } from '../ui/headerControl';
import type { PaywallReason } from '../paywallPricing';

/** The crown's drawn size inside the square. */
const CROWN_SIZE = 24;

/**
 * Whether the button draws at all. Exported for a row that has to make room
 * for it: the Explore search panel lines up with the field, so it needs to
 * know how much of the row the crown took.
 */
export function useShowsUpgrade(): boolean {
  const entitlements = useEntitlements();
  return entitlements !== undefined && !entitlements.is_premium;
}

interface Props {
  /** Why the sheet opens, which picks its subtitle. Omit for the generic pitch. */
  reason?: PaywallReason;
  /** Outer layout only: margins, alignment, absolute placement. */
  style?: StyleProp<ViewStyle>;
  /** Faded into the background while another control in its row owns an open panel. */
  dimmed?: boolean;
  /** When set, a tap closes that open panel instead of opening the sheet. */
  onDismiss?: () => void;
}

export function UpgradeButton({ reason = null, style, dimmed = false, onDismiss }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const shows = useShowsUpgrade();

  if (!shows) return null;

  // The Next pill's ink: white on the light theme's deeper gold, the dark ink
  // on the dark theme's pale gold, where white would be unreadable.
  const ink = scheme === 'light' ? '#FFFFFF' : tc.goldDeep;

  return (
    <TouchableOpacity
      style={[s.button, dimmed && s.dimmed, style]}
      onPress={withTap(onDismiss ?? (() => openPremiumSheet(reason)))}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={t('settings:upgradeToPlus')}
    >
      <CrownIcon size={CROWN_SIZE} color={ink} />
    </TouchableOpacity>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    // The filter button's construction (box, 1px rim, soft shadow), in gold.
    button: {
      width: HEADER_CONTROL.size,
      height: HEADER_CONTROL.size,
      borderRadius: HEADER_CONTROL.radius,
      borderWidth: 1,
      borderColor: tc.nodeGoldEdge,
      backgroundColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    // The filter button's dim, so the two controls fade to the same depth.
    dimmed: {
      opacity: 0.35,
    },
  });

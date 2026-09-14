/**
 * AccountScreen — what you have, and the two things you can do to an account.
 *
 * Split out of the Settings scroll so the two things you do *to* an account are
 * not sitting in the same list as the things you set *on* one. Deletion in
 * particular was three swipes below the language picker; it is now behind a
 * deliberate navigation step, which is the right amount of friction for the
 * only irreversible action in the app.
 *
 * ## The Subscription section used to say nothing about a subscription
 *
 * It held Family Plan and Restore Purchases and no status at all — no tier, no
 * renewal, no upgrade. `useIsPremium` appeared exactly once in the entire
 * Profile tree, and not here. So a subscriber could not confirm they were
 * subscribed, and someone who wanted to pay could not do it from the account
 * area: the paywall was reachable only by being turned away from something
 * mid-session, which is the moment a person is least inclined to read it.
 *
 * The rows are now driven by `subscriptionStatus`, which decides what to show
 * from the entitlement — including the case where the entitlement is not known
 * yet, where it shows neither "Free" nor an upgrade pitch. Guessing "free"
 * there is exactly how a paying customer gets asked to pay again.
 */

import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { showConfirm } from '../../stores/confirmStore';
import { showToast } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useEntitlements } from '../../stores/entitlementsStore';
import { getFormattingLocale } from '../../i18n';
import { LinkRow, Row, Rows, Section } from './settings/SettingsUI';
import { formatRenewal, subscriptionStatus } from './subscriptionStatus';

interface Props {
  onBack: () => void;
  onNavigateToFamilyPlan: () => void;
  onNavigateToPaywall: () => void;
}

export function AccountScreen({ onBack, onNavigateToFamilyPlan, onNavigateToPaywall }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();
  const entitlements = useEntitlements();
  const [restoring, setRestoring] = useState(false);

  const status = useMemo(() => subscriptionStatus(entitlements), [entitlements]);
  const renewal = formatRenewal(status.expiresAt, getFormattingLocale());

  /**
   * Restore a purchase made on another device or before a reinstall.
   *
   * Three things were wrong here. The server's answer was discarded — it
   * returns `restored: false` even for an active subscriber, with the useful
   * message "Your subscription is already active", and the old code checked
   * only the boolean and fell through to a native path that said "Billing not
   * available in this build". So a premium user tapping Restore was told,
   * under a translated title, in English, that billing did not work.
   *
   * It also never refreshed entitlements on success, so a genuine restore left
   * the app still showing the free tier until the next cold start — the same
   * class of staleness as the sign-in bug.
   */
  const handleRestorePurchases = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const { restorePurchases } = require('../../services/billing') as typeof import('../../services/billing');
      const result = await restorePurchases();
      if (result.restored) {
        // Re-read the account before telling them it worked, so the screen
        // behind the alert already agrees with the alert.
        await useAuthStore.getState().refreshUser();
      }
      Alert.alert(
        result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'),
        // `messageKey` where the service has one, so the body is in the user's
        // language rather than the English the service used to hardcode.
        result.messageKey ? t(result.messageKey) : result.message,
      );
    } catch {
      showToast({ tone: 'error', message: t('billing:paywall.restoreFailed') });
    } finally {
      setRestoring(false);
    }
  };

  /**
   * Still double-confirmed, and the confirmation is still `destructive` — the
   * row is quiet, the commitment is not.
   */
  const handleDeleteAccount = () =>
    showConfirm({
      title: t('settings:menu.deleteAccountTitle'),
      message: t('settings:menu.deleteAccountBody'),
      confirmLabel: t('settings:menu.delete'),
      tone: 'destructive',
      onConfirm: () => {
        useAuthStore.getState().deleteAccount().catch(() => {
          Alert.alert(
            t('settings:menu.deleteFailedTitle'),
            t('settings:menu.deleteFailedBody'),
          );
        });
      },
    });

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader onBack={onBack} title={t('settings:account')} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}>
        <Section
          title={t('settings:subscription')}
          footer={status.showUpgrade ? t('settings:subscriptionFreeFooter') : undefined}
        >
          <Rows>
            {/* Read-only: the plan itself is managed by the store, not by us.
                It is here so the answer to "am I paying for this?" does not
                require opening the App Store. */}
            <Row
              label={t('settings:currentPlan')}
              right={
                <View style={s.planEnd}>
                  <Text style={s.planValue}>{t(status.labelKey)}</Text>
                  {renewal ? <Text style={s.planMeta}>{t('settings:renews', { date: renewal })}</Text> : null}
                </View>
              }
            />
            {status.showUpgrade ? (
              <LinkRow
                label={t('settings:upgradeToPlus')}
                description={t('settings:upgradeToPlusDesc')}
                onPress={onNavigateToPaywall}
              />
            ) : null}
            {status.familyPlanAvailable ? (
              <LinkRow label={t('settings:familyPlan')} onPress={onNavigateToFamilyPlan} />
            ) : null}
            {status.showRestore ? (
              <LinkRow
                label={
                  restoring ? t('settings:restoringPurchases') : t('settings:restorePurchases')
                }
                onPress={handleRestorePurchases}
              />
            ) : null}
          </Rows>
        </Section>

        {/* Deletion has to be reachable in-app (App Store 5.1.1(v)), and it is
            the one row nobody should reach by accident. Last section, muted
            rather than red: red is an alarm colour and an alarm draws the eye,
            which is the opposite of what this row wants. */}
        <Section footer={t('settings:deleteAccountFooter')}>
          <LinkRow label={t('settings:menu.deleteAccount')} muted onPress={handleDeleteAccount} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    scroll: { paddingHorizontal: 16, paddingTop: 20 },
    planEnd: { alignItems: 'flex-end', flexShrink: 1 },
    planValue: { fontSize: 15, fontWeight: '700', color: tc.goldOnSurface },
    planMeta: { fontSize: 12, color: tc.textFaint, marginTop: 2 },
  });

/**
 * AccountScreen — subscription and account deletion.
 *
 * Split out of the Settings scroll so the two things you do *to* an account
 * are not sitting in the same list as the things you set *on* one. Deletion in
 * particular was three swipes below the language picker; it is now behind a
 * deliberate navigation step, which is the right amount of friction for the
 * only irreversible action in the app.
 */

import { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { showConfirm } from '../../stores/confirmStore';
import { useAuthStore } from '../../stores/authStore';
import { LinkRow, Rows, Section } from './settings/SettingsUI';

interface Props {
  onBack: () => void;
  onNavigateToFamilyPlan: () => void;
}

export function AccountScreen({ onBack, onNavigateToFamilyPlan }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();

  const handleRestorePurchases = async () => {
    const { restorePurchases } = require('../../services/billing');
    const result = await restorePurchases();
    Alert.alert(
      result.restored ? t('billing:paywall.restoredTitle') : t('billing:paywall.notFoundTitle'),
      result.message,
    );
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
        <Section title={t('settings:subscription')}>
          <Rows>
            <LinkRow label={t('settings:familyPlan')} onPress={onNavigateToFamilyPlan} />
            <LinkRow label={t('settings:restorePurchases')} onPress={handleRestorePurchases} />
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
  });

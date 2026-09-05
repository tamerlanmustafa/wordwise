/**
 * LegalScreen — terms and conditions.
 *
 * A two-row hub rather than a section inside Settings. Both documents are
 * things a user (or a store reviewer) goes looking for deliberately, and both
 * have to stay reachable in-app for review — a named destination is easier to
 * find and harder to lose in a future settings reshuffle than two links
 * halfway down a scroll.
 */

import { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useBottomBarInset } from '../../hooks/useBottomBarInset';
import { ScreenHeader } from '../common/ScreenHeader';
import { LinkRow, Rows, Section } from './settings/SettingsUI';

interface Props {
  onBack: () => void;
  onNavigateToPrivacy: () => void;
  onNavigateToTerms: () => void;
}

export function LegalScreen({ onBack, onNavigateToPrivacy, onNavigateToTerms }: Props) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const barInset = useBottomBarInset();

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScreenHeader onBack={onBack} title={t('settings:legal')} />
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: barInset + 24 }]}>
        <Section>
          <Rows>
            <LinkRow label={t('settings:privacyPolicy')} onPress={onNavigateToPrivacy} />
            <LinkRow label={t('settings:termsOfService')} onPress={onNavigateToTerms} />
          </Rows>
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

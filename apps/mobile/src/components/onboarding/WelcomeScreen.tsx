/**
 * WelcomeScreen — onboarding step 1 (prototype §1). Full-bleed reelStock
 * background with a warm radial glow, a gold film-reel ring, the serif
 * headline, body copy and the gold "Get started" CTA.
 *
 * The prototype's "I already have an account" link is dropped: this flow
 * runs *after* authentication in WordWise (see core/App.tsx gating), so the
 * user is already signed in by the time they see it.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, useColorScheme, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { OnboardingCTA } from './OnboardingCTA';

export interface WelcomeScreenProps {
  onGetStarted: () => void;
}

export function WelcomeScreen({ onGetStarted }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        {/* Warm radial glow — a soft tinted disc behind the mark. */}
        <View
          style={[
            s.glow,
            {
              backgroundColor:
                scheme === 'dark' ? 'rgba(255,140,40,0.10)' : 'rgba(197,139,27,0.08)',
            },
          ]}
          pointerEvents="none"
        />
        <View style={s.ring}>
          <Ionicons name="film-outline" size={40} color={tc.gold} />
        </View>
        <Text style={s.headline}>{t('onboarding:welcome.headline')}</Text>
        <Text style={s.copy}>{t('onboarding:welcome.copy')}</Text>
      </View>
      <OnboardingCTA label={t('onboarding:welcome.cta')} onPress={onGetStarted} />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.reelStock },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    glow: {
      position: 'absolute',
      width: 360,
      height: 360,
      borderRadius: 180,
      top: '22%',
    },
    ring: {
      width: 88,
      height: 88,
      borderRadius: 44,
      borderWidth: 3,
      borderColor: tc.gold,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 30,
    },
    headline: {
      fontFamily: SERIF_FAMILY,
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: -0.8,
      lineHeight: 38,
      textAlign: 'center',
      color: tc.text,
    },
    copy: {
      marginTop: 14,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      color: tc.textSecondary,
      maxWidth: 300,
    },
  });

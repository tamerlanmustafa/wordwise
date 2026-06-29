/**
 * OnboardingCTA — the gold pill that sits at the bottom of every onboarding
 * step (prototype's CTABar). Uses PressableScale for instant tactile feedback
 * (native-driver, reduce-motion safe). `disabled` dims it and blocks the tap.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { PressableScale } from '../ui/PressableScale';

export interface OnboardingCTAProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export function OnboardingCTA({ label, onPress, disabled }: OnboardingCTAProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.bar}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        accessibilityLabel={label}
        onPress={disabled ? undefined : onPress}
        style={[s.btn, disabled && s.btnDisabled]}
      >
        <Text style={s.label}>{label}</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    bar: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18 },
    btn: {
      backgroundColor: tc.gold,
      paddingVertical: 15,
      paddingHorizontal: 16,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    btnDisabled: { opacity: 0.45 },
    label: {
      color: tc.goldDeep,
      fontWeight: '900',
      fontSize: 14,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });

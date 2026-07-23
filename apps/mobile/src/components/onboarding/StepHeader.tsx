/**
 * StepHeader — the shared onboarding header: a back chevron, a segmented
 * progress bar (gold = done), an optional mono eyebrow and a serif title.
 * Mirrors the prototype's StepHeader (launch/onboarding.jsx).
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../../theme/fonts';

export interface StepHeaderProps {
  /** 1-based index of the current step — segments `< step` render gold. */
  step: number;
  total: number;
  title?: string;
  eyebrow?: string;
  /** Hide the back chevron on the first interactive step. */
  onBack?: () => void;
}

export function StepHeader({ step, total, title, eyebrow, onBack }: StepHeaderProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.back')}
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="chevron-back" size={16} color={tc.textSecondary} />
          </Pressable>
        ) : null}
        <View style={s.bar}>
          {Array.from({ length: total }).map((_, i) => (
            <View
              key={i}
              style={[s.segment, { backgroundColor: i < step ? tc.gold : tc.divider }]}
            />
          ))}
        </View>
      </View>
      {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={s.title}>{title}</Text> : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: 18, paddingTop: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bar: { flex: 1, flexDirection: 'row', gap: 5 },
    segment: { flex: 1, height: 4, borderRadius: 999 },
    eyebrow: {
      marginTop: 22,
      fontFamily: MONO_FAMILY,
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 2,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    title: {
      marginTop: 8,
      fontFamily: SERIF_FAMILY,
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.6,
      lineHeight: 32,
      color: tc.text,
    },
  });

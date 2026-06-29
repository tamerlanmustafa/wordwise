/**
 * EmptyState — the shared centered empty/zero/error layout (States §D).
 * Icon-in-ring + serif title + body + optional primary CTA + sub-CTA. Used for
 * the empty reel, "nothing due", and network-error states so they stay
 * visually consistent (the prototype's `Centered` helper).
 *
 * `tone` tints the icon ring: neutral (gold), success (green), error (red).
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { PressableScale } from '../ui/PressableScale';

export type EmptyStateTone = 'neutral' | 'success' | 'error';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  tone?: EmptyStateTone;
  ctaLabel?: string;
  onCta?: () => void;
  subCtaLabel?: string;
  onSubCta?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  body,
  tone = 'neutral',
  ctaLabel,
  onCta,
  subCtaLabel,
  onSubCta,
  style,
}: EmptyStateProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const accent = tone === 'success' ? tc.success : tone === 'error' ? tc.error : tc.gold;
  const ringBg = tone === 'success' ? tc.successTint : tone === 'error' ? tc.errorTint : tc.primaryTint;

  return (
    <View style={[s.root, style]}>
      <View style={[s.ring, { backgroundColor: ringBg, borderColor: accent }]}>
        <Ionicons name={icon} size={32} color={accent} />
      </View>
      <Text style={s.title}>{title}</Text>
      {body ? <Text style={s.body}>{body}</Text> : null}
      {ctaLabel && onCta ? (
        <PressableScale style={s.cta} onPress={onCta} accessibilityRole="button" accessibilityLabel={ctaLabel}>
          <Text style={s.ctaText}>{ctaLabel}</Text>
        </PressableScale>
      ) : null}
      {subCtaLabel && onSubCta ? (
        <PressableScale style={s.subCta} onPress={onSubCta} accessibilityRole="button" accessibilityLabel={subCtaLabel}>
          <Text style={s.subCtaText}>{subCtaLabel}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
    ring: {
      width: 84,
      height: 84,
      borderRadius: 42,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 22,
    },
    title: { fontFamily: SERIF_FAMILY, fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: tc.text, textAlign: 'center' },
    body: { marginTop: 10, fontSize: 14, lineHeight: 21, color: tc.textSecondary, textAlign: 'center', maxWidth: 300 },
    cta: {
      marginTop: 24,
      backgroundColor: tc.gold,
      paddingVertical: 14,
      paddingHorizontal: 28,
      borderRadius: 14,
      alignItems: 'center',
    },
    ctaText: { color: tc.goldDeep, fontWeight: '900', fontSize: 14, letterSpacing: 0.5, textTransform: 'uppercase' },
    subCta: { marginTop: 14, paddingVertical: 6, paddingHorizontal: 16 },
    subCtaText: { color: tc.textSecondary, fontSize: 13, fontWeight: '700' },
  });

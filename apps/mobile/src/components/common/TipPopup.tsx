/**
 * TipPopup — reusable one-shot educational tip overlay.
 *
 * Used by ReviewScreen for the spacing-effect explainer that fires when
 * an SRS-resurfaced word reappears. Designed to be reused by any future
 * "did you know..." educational moment.
 *
 * Behavior:
 *   • Modal-style overlay with a card, headline, body, "Got it" CTA.
 *   • Optional "Don't show again" toggle — when checked, dismissing
 *     calls `onDontShowAgain` so the parent can persist via
 *     `tipDismissalsStore.dismiss(key)`.
 *   • Renders nothing while `visible=false`. Caller owns the visibility
 *     state so the parent can fade other UI in/out around it.
 */

import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

export interface TipPopupProps {
  visible: boolean;
  /** Headline above the body — short, bold, ~5 words. */
  title: string;
  /** 1–3 sentence explanation. */
  body: string;
  /** Optional eyebrow above the title (e.g. "Did you know?"). */
  eyebrow?: string;
  /** Fires when the user taps the primary CTA without checking "don't
   *  show again". Use this to close the popup. */
  onDismiss: () => void;
  /** Fires when the user taps the CTA AFTER checking "don't show again".
   *  Use this to both close the popup AND persist the dismissal. */
  onDontShowAgain?: () => void;
  ctaLabel?: string;
}

export function TipPopup({
  visible,
  title,
  body,
  eyebrow,
  onDismiss,
  onDontShowAgain,
  ctaLabel,
}: TipPopupProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = makeStyles(tc);
  const [dontShow, setDontShow] = useState(false);

  if (!visible) return null;

  const handleCta = () => {
    if (dontShow && onDontShowAgain) onDontShowAgain();
    else onDismiss();
  };

  return (
    <View style={s.overlay}>
      <View style={s.card}>
        {eyebrow ? <Text style={s.eyebrow}>{eyebrow}</Text> : null}
        <Text style={s.title}>{title}</Text>
        <Text style={s.body}>{body}</Text>

        {onDontShowAgain ? (
          <Pressable
            style={s.checkRow}
            onPress={() => setDontShow((v) => !v)}
            hitSlop={6}
          >
            <View style={[s.checkBox, dontShow ? s.checkBoxOn : null]}>
              {dontShow ? <Text style={s.checkGlyph}>✓</Text> : null}
            </View>
            <Text style={s.checkLabel}>{t('tip.dontShowAgain')}</Text>
          </Pressable>
        ) : null}

        <TouchableOpacity
          onPress={handleCta}
          activeOpacity={0.85}
          style={s.cta}
        >
          <Text style={s.ctaText}>{ctaLabel ?? t('action.gotIt')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 360,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.paper,
      paddingHorizontal: 22,
      paddingVertical: 24,
      gap: 10,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: tc.primaryOnSurface,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: tc.text,
      letterSpacing: 0.1,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: tc.textSecondary,
    },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 4,
    },
    checkBox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: tc.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkBoxOn: {
      backgroundColor: tc.primary,
      borderColor: tc.primary,
    },
    checkGlyph: {
      fontSize: 13,
      fontWeight: '900',
      color: tc.textInverse,
    },
    checkLabel: {
      fontSize: 13,
      color: tc.textSecondary,
      fontWeight: '600',
    },
    cta: {
      marginTop: 12,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: tc.primary,
      alignItems: 'center',
    },
    ctaText: {
      fontSize: 15,
      fontWeight: '800',
      color: tc.textInverse,
      letterSpacing: 0.3,
    },
  });

/**
 * ToastHost — renders the head of the toast queue (Motion §E5). Slides up +
 * fades in, holds for the toast's duration, then auto-dismisses (and shows the
 * next queued toast). Mount once near the app root (App.tsx), above the bottom
 * bar. Honors reduce-motion by skipping the slide.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useToastStore, type ToastTone } from '../../stores/toastStore';

const ICON: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  default: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
};

export function ToastHost() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const toast = useToastStore((st) => st.queue[0] ?? null);
  const dismiss = useToastStore((st) => st.dismiss);
  const [reduceMotion, setReduceMotion] = useState(false);

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: reduceMotion ? 0 : 240, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start(() => {
        dismiss(toast.id);
      });
    }, toast.duration);
    return () => clearTimeout(timer);
  }, [toast, anim, reduceMotion, dismiss]);

  if (!toast) return null;

  const accent = toast.tone === 'success' ? tc.success : toast.tone === 'error' ? tc.error : tc.gold;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  return (
    <SafeAreaView style={s.wrap} pointerEvents="box-none" edges={['bottom']}>
      <Animated.View style={[s.toast, { opacity: anim, transform: [{ translateY }] }]}>
        <Ionicons name={ICON[toast.tone]} size={18} color={accent} />
        <Text style={s.text} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.actionLabel && toast.onAction ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              toast.onAction?.();
              dismiss(toast.id);
            }}
            accessibilityRole="button"
          >
            <Text style={[s.action, { color: accent }]}>{toast.actionLabel}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, bottom: 86, alignItems: 'center', zIndex: 9998 },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      maxWidth: '90%',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 14,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    text: { flex: 1, fontSize: 14, fontWeight: '600', color: tc.text },
    action: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  });

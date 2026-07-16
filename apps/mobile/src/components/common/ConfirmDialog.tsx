/**
 * ConfirmDialog — renders the active confirmStore dialog as a centered modal
 * (Motion §E). Mount once near the app root (App.tsx), like ToastHost. Unlike
 * a native Alert.alert, this honors the in-app light/dark theme via
 * useThemeColors, so the dialog matches the app even when the OS appearance
 * differs from the user's WordWise theme preference. Honors reduce-motion by
 * skipping the pop-in scale.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useConfirmStore } from '../../stores/confirmStore';

export function ConfirmDialog() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const current = useConfirmStore((st) => st.current);
  const handleConfirm = useConfirmStore((st) => st.handleConfirm);
  const handleCancel = useConfirmStore((st) => st.handleCancel);
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
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: true,
    }).start();
  }, [current, anim, reduceMotion]);

  if (!current) return null;

  const destructive = current.tone === 'destructive';
  const confirmColor = destructive ? tc.error : tc.primary;
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={s.overlay}>
        <Animated.View style={[s.card, { opacity: anim, transform: [{ scale }] }]}>
          <Text style={s.title}>{current.title}</Text>
          {current.message ? <Text style={s.message}>{current.message}</Text> : null}

          <View style={s.actions}>
            <TouchableOpacity
              style={[s.btn, s.btnGhost]}
              onPress={handleCancel}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostText}>{current.cancelLabel ?? 'Cancel'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: confirmColor }]}
              onPress={handleConfirm}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={s.btnConfirmText}>{current.confirmLabel ?? 'Confirm'}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: tc.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 28,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: tc.paper,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tc.border,
      padding: 22,
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: -0.2,
      color: tc.text,
    },
    message: {
      fontSize: 14,
      lineHeight: 20,
      color: tc.textSecondary,
      marginTop: 8,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 22,
    },
    btn: {
      paddingVertical: 11,
      paddingHorizontal: 18,
      borderRadius: 12,
      minWidth: 92,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnGhost: {
      backgroundColor: tc.chipBg,
      borderWidth: 1,
      borderColor: tc.border,
    },
    btnGhostText: {
      fontSize: 14.5,
      fontWeight: '700',
      color: tc.textSecondary,
    },
    btnConfirmText: {
      fontSize: 14.5,
      fontWeight: '800',
      color: '#FFFFFF',
    },
  });

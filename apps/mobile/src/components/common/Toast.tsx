/**
 * ToastHost — the app's transient confirmations (Motion §E5). Mount once near
 * the app root (App.tsx); it draws over everything.
 *
 * ## Top, not bottom
 *
 * Toasts drop in from the top edge and sit under the status bar. They used to
 * rise from `bottom: 86`, a number chosen to clear the floating tab bar, and
 * that put every confirmation in the same 90pt of screen as the bar itself, the
 * word feed's action rail and the sheets' primary buttons. A toast with an Undo
 * is a control, and it was landing on top of the controls you had just used —
 * so the tap that produced it and the tap that reverses it were within a thumb
 * of each other, which is how you undo something by accident.
 *
 * The top edge is the one part of the screen this app never puts a control on.
 * It also means the toast no longer has to know the bottom bar's height, which
 * was a real coupling: `bottom: 86` was a hand-copy of a number that lives in
 * `useBottomBarInset`, and nothing would have failed if the bar had changed.
 *
 * ## Several at once
 *
 * Each toast owns its own entrance, timer and exit, so a burst of card actions
 * stacks instead of queueing (see toastStore for why that matters — queued
 * Undos are unreachable Undos). The host renders `visibleToasts`; the store
 * caps how many that is.
 *
 * `LayoutAnimation` handles the re-flow when one in the middle of the stack
 * goes away — the toasts below it slide up rather than jumping. It is enabled
 * for Android at the top of App.tsx.
 *
 * ## Swipe to dismiss
 *
 * Up, or either side. Built on PanResponder + Animated rather than a native
 * gesture library, so this ships as an OTA; the thresholds are pure and live in
 * `utils/toastDismiss`. Downward rubber-bands instead of dismissing, because
 * down is the direction the toast arrived from.
 *
 * Reduce-motion is honoured by skipping the slide, not the toast.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutAnimation,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { useToastStore, visibleToasts, type Toast, type ToastTone } from '../../stores/toastStore';
import { directionSign } from '../../i18n/rtl';
import {
  rubberBand,
  shouldClaimToastDrag,
  toastDismissOnRelease,
} from '../../utils/toastDismiss';
import { withTap } from '../../utils/feedback';

const ICON: Record<ToastTone, keyof typeof Ionicons.glyphMap> = {
  default: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
};

/** How far the toast travels on the way in. Short: it is arriving from just
 *  off the top edge, not flying in from the far side of the screen. */
const ENTER_TRAVEL = 28;
const ENTER_MS = 240;
const EXIT_MS = 200;
/** Far enough that the toast is clear of the widest phone before the row is
 *  removed and the stack closes up behind it. */
const OFFSCREEN_X = 600;

/** Re-flow when a toast leaves from the middle of the stack. Short enough that
 *  it reads as the gap closing rather than as an animation of its own. */
const STACK_ANIM = {
  duration: 180,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
};

function ToastRow({
  toast,
  reduceMotion,
  onDismiss,
}: {
  toast: Toast;
  reduceMotion: boolean;
  onDismiss: (id: string) => void;
}) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Entrance/exit opacity, and the two drag axes. Separate values because the
  // drag has to be able to move the toast while its entrance is still
  // finishing — a toast you swipe at 100ms should go, not snap back to a
  // position its entrance animation is still writing to.
  const enter = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;

  // Held in a ref so the pan responder — built once — can cancel the timer
  // without being rebuilt when it changes.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const leave = useCallback(
    (toX: number, toY: number) => {
      clearTimer();
      LayoutAnimation.configureNext(STACK_ANIM);
      Animated.parallel([
        Animated.timing(enter, { toValue: 0, duration: EXIT_MS, useNativeDriver: true }),
        Animated.timing(dragX, { toValue: toX, duration: EXIT_MS, useNativeDriver: true }),
        Animated.timing(dragY, { toValue: toY, duration: EXIT_MS, useNativeDriver: true }),
      ]).start(() => onDismiss(toast.id));
    },
    [clearTimer, enter, dragX, dragY, onDismiss, toast.id],
  );

  // Entrance + auto-dismiss, once per toast. `toast.id` rather than `toast`:
  // the store hands out a new array on every change, so depending on the object
  // would restart the timer of every toast on screen each time any one of them
  // arrived or left — the stack would never empty.
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 0 : ENTER_MS,
      useNativeDriver: true,
    }).start();
    timer.current = setTimeout(() => leave(0, -ENTER_TRAVEL), toast.duration);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => shouldClaimToastDrag(g.dx, g.dy),
        onMoveShouldSetPanResponderCapture: (_e, g) => shouldClaimToastDrag(g.dx, g.dy),
        // A toast that is being dragged must not vanish underneath the finger.
        // Its timer restarts on release only if the drag did not dismiss it.
        onPanResponderGrant: clearTimer,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          dragX.setValue(g.dx);
          dragY.setValue(rubberBand(g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          // Physical → logical, so "toward the trailing edge" survives RTL.
          const dir = toastDismissOnRelease(
            g.dx * directionSign,
            g.dy,
            g.vx * directionSign,
            g.vy,
          );
          if (dir === 'up') return leave(0, -200);
          if (dir === 'start') return leave(-OFFSCREEN_X * directionSign, 0);
          if (dir === 'end') return leave(OFFSCREEN_X * directionSign, 0);

          Animated.parallel([
            Animated.spring(dragX, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
          ]).start();
          // Give it its full dwell back rather than the remainder: the drag is
          // evidence you are still reading it.
          timer.current = setTimeout(() => leave(0, -ENTER_TRAVEL), toast.duration);
        },
        onPanResponderTerminate: () => {
          Animated.parallel([
            Animated.spring(dragX, { toValue: 0, useNativeDriver: true }),
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true }),
          ]).start();
          timer.current = setTimeout(() => leave(0, -ENTER_TRAVEL), toast.duration);
        },
      }),
    [clearTimer, dragX, dragY, leave, toast.duration],
  );

  const accent =
    toast.tone === 'success' ? tc.success : toast.tone === 'error' ? tc.error : tc.gold;

  // The entrance slide and the drag add up: one animated node, two inputs.
  const translateY = Animated.add(
    enter.interpolate({
      inputRange: [0, 1],
      outputRange: [reduceMotion ? 0 : -ENTER_TRAVEL, 0],
    }),
    dragY,
  );

  return (
    <Animated.View
      style={[s.toast, { opacity: enter, transform: [{ translateX: dragX }, { translateY }] }]}
      accessibilityLiveRegion="polite"
      {...pan.panHandlers}
    >
      <Ionicons name={ICON[toast.tone]} size={18} color={accent} />
      <Text style={s.text} numberOfLines={2}>
        {toast.message}
      </Text>
      {toast.actionLabel && toast.onAction ? (
        <Pressable
          hitSlop={10}
          onPress={withTap(() => {
            toast.onAction?.();
            leave(0, -ENTER_TRAVEL);
          })}
          accessibilityRole="button"
        >
          <Text style={[s.action, { color: accent }]}>{toast.actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function ToastHost() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const queue = useToastStore((st) => st.queue);
  const dismiss = useToastStore((st) => st.dismiss);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    return () => {
      mounted = false;
    };
  }, []);

  const shown = visibleToasts(queue);
  if (shown.length === 0) return null;

  return (
    // `box-none` on both the safe area and the column: the strip spans the full
    // width so the toasts can centre in it, and everything under that width
    // outside a toast itself still has to be tappable.
    <SafeAreaView style={s.wrap} pointerEvents="box-none" edges={['top']}>
      <View style={s.stack} pointerEvents="box-none">
        {shown.map((toast) => (
          <ToastRow key={toast.id} toast={toast} reduceMotion={reduceMotion} onDismiss={dismiss} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 9998 },
    stack: { paddingTop: 8, gap: 8, alignItems: 'center' },
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
      // Casts downward now that the toast hangs from the top edge — a shadow
      // pointing back at the edge it came from reads as the toast floating
      // under the notch rather than over the screen.
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
    text: { flex: 1, fontSize: 14, fontWeight: '600', color: tc.text },
    action: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  });

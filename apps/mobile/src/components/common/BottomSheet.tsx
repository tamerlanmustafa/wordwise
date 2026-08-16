/**
 * BottomSheet — the shared slide-up container.
 *
 * An absolute-position overlay rather than a `Modal`, for the same reason
 * UserMenuSheet is: a Modal renders in its own native window and would cover
 * the GlobalBottomBar, so the tab bar would stop responding while a sheet is
 * open. Overlaying inside the tree keeps the bar live and matches how every
 * other sheet in the app behaves.
 *
 * The scrim and the sheet both stop at `bottomOffset` so the bar is never
 * covered. Callers pass the measured bar height.
 *
 * Extracted from the UserMenuSheet / NotificationsSheet pattern when the
 * Lists tab needed two more sheets; those two are untouched, but new sheets
 * should build on this rather than hand-rolling a third copy.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Height of GlobalBottomBar — sheet and scrim stop above it. */
  bottomOffset?: number;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, bottomOffset = 0, children }: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Start well off-screen; the real distance is set once the sheet measures
  // itself, so it always fully clears the bar however tall it grows.
  const slide = useRef(new Animated.Value(900)).current;
  const hiddenY = useRef(900);
  const measured = useRef(false);

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : hiddenY.current,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [visible, slide]);

  const onSheetLayout = (e: LayoutChangeEvent) => {
    // Slack past its own height so the sheet always fully clears the bar
    // however tall it grows — the same allowance UserMenuSheet uses.
    const height = e.nativeEvent.layout.height + bottomOffset + 24;
    hiddenY.current = height;
    // Snap straight to the hidden position the first time, so the sheet
    // doesn't animate up from nowhere on mount.
    if (!measured.current) {
      measured.current = true;
      if (!visible) slide.setValue(height);
    }
  };

  if (!visible && measured.current === false) return null;

  return (
    // `overflow: hidden` is load-bearing, not cosmetic: the sheet hides by
    // translating past this container's bottom edge, and RN does not clip by
    // default — without it the closed sheet's text paints straight through
    // the home-indicator strip below the tab bar.
    <View
      style={[StyleSheet.absoluteFill, { bottom: bottomOffset, overflow: 'hidden' }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <TouchableWithoutFeedback onPress={onClose} accessible={false}>
        <Animated.View
          style={[
            s.scrim,
            { opacity: slide.interpolate({
                inputRange: [0, Math.max(1, hiddenY.current)],
                outputRange: [1, 0],
                extrapolate: 'clamp',
              }) },
          ]}
        />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[s.sheet, { transform: [{ translateY: slide }] }]}
        onLayout={onSheetLayout}
      >
        <View style={s.grabber} />
        {children}
      </Animated.View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    backgroundColor: tc.paper,
    borderTopStartRadius: 24,
    borderTopEndRadius: 24,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: tc.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
});

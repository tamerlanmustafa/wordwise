/**
 * BottomSheet — the shared slide-up container.
 *
 * An absolute-position overlay rather than a `Modal`, for the same reason
 * UserMenuSheet is: a Modal renders in its own native window and would cover
 * the GlobalBottomBar, so the tab bar would stop responding while a sheet is
 * open. Overlaying inside the tree keeps the bar live and matches how every
 * other sheet in the app behaves.
 *
 * The overlay covers the **whole** screen, bar included. It used to stop at
 * `bottomOffset`, on the reasoning that the bar must stay live — but the bar
 * is rendered after every sheet in App.tsx, so it draws on top and stays
 * tappable regardless. All the inset actually bought was a strip of
 * *undimmed* content along the bottom of the screen, most visible under the
 * iOS 26 glass capsule, which floats clear of the screen edge and so had
 * bright content showing above, below and around it while a sheet was open.
 *
 * `bottomOffset` still matters, but as padding *inside* the sheet: the sheet
 * now reaches the screen's bottom edge and reserves the bar's height so no row
 * of its own can hide behind the capsule.
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
import { Vignette } from './Vignette';

/** Pulls the top and bottom edges down past the flat scrim tint. Deeper than
 *  the tint itself, or it would not read as an edge at all. */
const SCRIM_EDGE = 'rgba(0,0,0,0.34)';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** GlobalBottomBar's reserved height. Padding inside the sheet, so its last
   *  row clears the bar; the scrim itself covers the full screen. */
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
    // Slack past its own height so the closed sheet is fully off-screen. The
    // bar's height is inside this measurement now (it is the sheet's own
    // paddingBottom), so it must not be added a second time.
    const height = e.nativeEvent.layout.height + 24;
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
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* The scrim carries a vignette as well as the flat tint, matching the
          search overlay — a screen that has gone behind something should look
          the same whichever thing it is behind. The gradients are children of
          the dismiss target rather than siblings, so they ride its fade, and
          they take no touches of their own. */}
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
        >
          <Vignette color={SCRIM_EDGE} />
        </Animated.View>
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          s.sheet,
          { paddingBottom: SHEET_PAD_BOTTOM + bottomOffset },
          { transform: [{ translateY: slide }] },
        ]}
        onLayout={onSheetLayout}
      >
        <View style={s.grabber} />
        {children}
      </Animated.View>
    </View>
  );
}

/** The sheet's own bottom padding, before the bar's height is added. */
const SHEET_PAD_BOTTOM = 24;

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
    // paddingBottom is applied inline — it carries the bar's reserved height.
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

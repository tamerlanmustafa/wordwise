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
 *
 * ## The keyboard
 *
 * A bottom-anchored sheet and a keyboard want the same part of the screen, so
 * any sheet with a text field in it — `NewListSheet` is the one that surfaced
 * this — had its field covered the moment it was focused: you were typing
 * into something you could not see. The sheet now rides above the keyboard.
 *
 * It is handled here rather than in each sheet because the geometry is this
 * component's, not theirs: they contribute content and know nothing about
 * where the sheet is pinned. Sheets with no input are unaffected, since a
 * keyboard they never raise leaves the height at zero.
 */

import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Keyboard,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useThemeColors, useColorScheme, type ThemeColors } from '../../theme/tokens';
import { KEYBOARD_EASING, useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { Vignette } from './Vignette';

/** Pulls the top and bottom edges down past the flat scrim tint. Deeper than
 *  the tint itself, or it would not read as an edge at all. */
const SCRIM_EDGE = 'rgba(0,0,0,0.34)';

/** Breathing room between the sheet's bottom edge and the keyboard's top. */
const KEYBOARD_GAP = 6;

/** Backdrop blur strength. Enough that text behind stops being readable —
 *  which is the point — without turning the page into flat grey. */
const SCRIM_BLUR = 24;

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
  const { height: keyboard, duration } = useKeyboardHeight();
  const scheme = useColorScheme();

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

  /**
   * The sheet rides up to sit on the keyboard, and gives back the bar's space
   * as it goes.
   *
   * Two values because they cannot share a driver. `lift` is a transform and
   * runs natively beside the entrance spring; `barSpace` is the height of the
   * strip reserved for the floating tab bar, which is layout and cannot. They
   * animate on the same duration and curve, so the sheet rises while the dead
   * strip under its last row closes up — assigning either directly made that
   * half of the movement snap while the other gilded.
   *
   * Reserving the bar's height is right at rest and wrong under a keyboard:
   * the bar is behind the keys then, so the space is a gap between the sheet
   * and the keyboard rather than clearance for anything.
   */
  const lift = useRef(new Animated.Value(0)).current;
  const barSpace = useRef(new Animated.Value(bottomOffset)).current;

  useEffect(() => {
    const up = keyboard > 0;
    Animated.parallel([
      Animated.timing(lift, {
        toValue: up ? keyboard + KEYBOARD_GAP : 0,
        duration,
        easing: KEYBOARD_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(barSpace, {
        toValue: up ? 0 : bottomOffset,
        duration,
        easing: KEYBOARD_EASING,
        useNativeDriver: false,
      }),
    ]).start();
  }, [keyboard, duration, bottomOffset, lift, barSpace]);

  /**
   * A closing sheet takes its keyboard with it.
   *
   * Every way out of a sheet with a field in it left the keys up: the scrim
   * tap, the hardware back, and — the one a user actually hits — a successful
   * create, which calls `onClose` while the field is still focused. The sheet
   * would slide away behind a keyboard that stayed, hovering over a screen
   * with nothing to type into.
   *
   * Here rather than in each sheet for the same reason the lift is: the sheet
   * owns its own dismissal, and its children do not know they are being
   * closed. Sheets with no field raise no keyboard, so this is a no-op for
   * them rather than something they have to opt out of.
   */
  useEffect(() => {
    if (!visible) Keyboard.dismiss();
  }, [visible]);

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
          {/* Blur first, tint over it. Blurring alone leaves the screen
              legible enough to keep reading, which is the opposite of what a
              modal surface is for; tinting alone leaves every edge behind it
              sharp enough to compete with the sheet. Together the page reads
              as *behind* something rather than merely darker. */}
          <BlurView
            intensity={SCRIM_BLUR}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.scrimTint} />
          <Vignette color={SCRIM_EDGE} />
        </Animated.View>
      </TouchableWithoutFeedback>

      <Animated.View
        style={[
          s.sheet,
          // Two translations, not one summed value. `slide` is the show/hide
          // spring; folding the keyboard offset into it would make the sheet
          // re-animate its entrance every time the keyboard moved.
          { transform: [{ translateY: slide }, { translateY: Animated.multiply(lift, -1) }] },
        ]}
        onLayout={onSheetLayout}
      >
        <View style={s.grabber} />
        {children}
        {/* The bar's reserved strip, as a child rather than as padding, so it
            can animate its own height on the JS driver while the sheet's
            transform stays native. Mixing the two on one view is not allowed
            and, before this, showed as the padding snapping shut under a
            sheet that was still gliding. */}
        <Animated.View style={{ height: barSpace }} pointerEvents="none" />
      </Animated.View>
    </View>
  );
}

/** The sheet's own bottom padding, before the bar's height is added. */
const SHEET_PAD_BOTTOM = 24;

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  // Lighter than the flat 0.48 it replaces: the blur underneath is now doing
  // half the work of separating the sheet from the page, so the same total
  // effect needs less black.
  scrimTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    backgroundColor: tc.paper,
    // All four corners, not just the top two. At rest the bottom pair sit at
    // the screen edge and read as square anyway; lifted over a keyboard they
    // are the sheet's visible bottom edge, and two hard corners there made it
    // look torn off rather than floating.
    borderRadius: 24,
    paddingTop: 10,
    paddingBottom: SHEET_PAD_BOTTOM,
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

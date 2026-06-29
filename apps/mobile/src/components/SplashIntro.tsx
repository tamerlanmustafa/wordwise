/**
 * SplashIntro — cold-start splash shown once on first launch (Motion §E2).
 *
 * A spinning film-reel mark, the WordWise wordmark + "Learn the reel words",
 * reel-sprocket gutters down the sides, and a thin determinate progress bar.
 * It's also the surface deferred cold-start work hides behind.
 *
 * Migrated off the static `palette` snapshot onto useThemeColors so it flips
 * with the theme. Honors reduce-motion: the reel + progress settle to their
 * static end-state instead of animating. Still keyed off
 * `wordwise.splashShown.v1` so it only appears on the very first launch.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { SERIF_FAMILY, MONO_FAMILY } from '../theme/fonts';

const KEY = 'wordwise.splashShown.v1';
const TRACK_W = 160;

export function SplashIntro() {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(KEY),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
    ]).then(([seen, reduce]) => {
      if (!mounted || seen) return;
      setReduceMotion(reduce);
      setVisible(true);

      // Reel spin (native-driver rotate) — skipped under reduce-motion.
      let reel: Animated.CompositeAnimation | null = null;
      if (!reduce) {
        reel = Animated.loop(
          Animated.timing(spin, { toValue: 1, duration: 3400, easing: Easing.linear, useNativeDriver: true }),
        );
        reel.start();
      }

      // Fade in → hold (progress fills) → fade out, then dismiss for good.
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(progress, {
          toValue: 1,
          duration: reduce ? 0 : 2100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(150),
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start(() => {
        reel?.stop();
        setVisible(false);
        AsyncStorage.setItem(KEY, '1').catch(() => {});
      });
    });
    return () => {
      mounted = false;
    };
  }, [opacity, spin, progress]);

  if (!visible) return null;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // scaleX scales around the view centre; pair it with a translateX so the
  // bar appears to grow from the left edge (TRACK_W / 2 at empty → 0 at full).
  const fillShift = progress.interpolate({ inputRange: [0, 1], outputRange: [-TRACK_W / 2, 0] });

  return (
    <Animated.View style={[s.overlay, { opacity }]} pointerEvents="none">
      {/* Reel-sprocket gutters down both edges. */}
      <SprocketGutter tc={tc} side="left" />
      <SprocketGutter tc={tc} side="right" />

      <View style={s.center}>
        <Animated.View style={[s.reel, !reduceMotion && { transform: [{ rotate }] }]}>
          <View style={[s.reelRing, { borderColor: tc.gold }]} />
          {Array.from({ length: 5 }).map((_, i) => {
            const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
            return (
              <View
                key={i}
                style={[
                  s.reelHole,
                  { borderColor: tc.gold, left: 38 + Math.cos(a) * 21, top: 38 + Math.sin(a) * 21 },
                ]}
              />
            );
          })}
          <View style={[s.reelHub, { backgroundColor: tc.gold }]} />
        </Animated.View>

        <Text style={s.wordmark}>WordWise</Text>
        <Text style={s.tagline}>Learn the reel words</Text>

        <View style={[s.track, { backgroundColor: tc.divider }]}>
          <Animated.View
            style={[s.fill, { backgroundColor: tc.gold, transform: [{ translateX: fillShift }, { scaleX: progress }] }]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

function SprocketGutter({ tc, side }: { tc: ThemeColors; side: 'left' | 'right' }) {
  return (
    <View style={[gutterStyles.gutter, side === 'left' ? { left: 0 } : { right: 0 }]} pointerEvents="none">
      {Array.from({ length: 9 }).map((_, i) => (
        <View key={i} style={[gutterStyles.hole, { backgroundColor: tc.reelSprocket }]} />
      ))}
    </View>
  );
}

const gutterStyles = StyleSheet.create({
  gutter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 16,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    opacity: 0.5,
  },
  hole: { width: 8, height: 12, borderRadius: 2 },
});

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: tc.reelStock,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
    },
    center: { alignItems: 'center' },
    reel: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
    reelRing: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 3 },
    reelHole: { position: 'absolute', width: 13, height: 13, borderRadius: 7, borderWidth: 2 },
    reelHub: { width: 16, height: 16, borderRadius: 8 },
    wordmark: { marginTop: 26, fontFamily: SERIF_FAMILY, fontSize: 40, fontWeight: '700', color: tc.text, letterSpacing: -1 },
    tagline: { marginTop: 6, fontFamily: MONO_FAMILY, fontSize: 11, fontWeight: '700', letterSpacing: 2, color: tc.goldOnSurface, textTransform: 'uppercase' },
    track: { marginTop: 28, width: TRACK_W, height: 3, borderRadius: 999, overflow: 'hidden' },
    fill: { width: TRACK_W, height: '100%', borderRadius: 999, alignSelf: 'flex-start' },
  });

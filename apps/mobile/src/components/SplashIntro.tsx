/**
 * SplashIntro — shows the app name once on the very first launch,
 * then permanently dismisses itself. Fades in → holds → fades out.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../theme/palette';

const KEY = 'wordwise.splashShown.v1';

export function SplashIntro() {
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((seen) => {
      if (seen) return; // already shown on a previous launch
      setVisible(true);
      // Fade in → hold → fade out, then unmount.
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setVisible(false);
        AsyncStorage.setItem(KEY, '1').catch(() => {});
      });
    });
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents="none">
      <View style={styles.inner}>
        <Text style={styles.wordWise}>WordWise</Text>
        <Text style={styles.tagline}>Learn through the movies you love</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  inner: { alignItems: 'center' },
  wordWise: {
    fontSize: 42,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    letterSpacing: 0.2,
  },
});

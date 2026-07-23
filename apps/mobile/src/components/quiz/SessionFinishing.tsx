import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, type ThemeColors } from '../../theme/tokens';

/**
 * SessionFinishing — the "elevator button trick" for quiz completion.
 *
 * The moment the last card is answered we show this celebratory beat
 * immediately and run the (sequential) submit + score network calls *behind*
 * it. The reward becomes the latency mask instead of a dead "Scoring…" spinner
 * (see SMOOTHNESS_AND_DESIGN_PLAYBOOK §3). The caller holds this on screen for
 * a guaranteed minimum so the animation always lands even when the network is
 * fast, then swaps in the real result.
 *
 * Animates only `scale`/`opacity`/`translateY` on the native driver — no
 * layout work, so it stays smooth on cheap devices (playbook §8).
 */
export function SessionFinishing() {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const pop = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80 }),
      Animated.timing(rise, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();

    const ripple = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: 1100,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
    );
    ripple.start();
    return () => ripple.stop();
  }, [pop, rise, ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.7] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.32, 0.1, 0] });
  const riseTranslate = rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  // Gold on dark, success-green on light — mirrors the result-screen CTA rule.
  const badgeBg = scheme === 'dark' ? tc.gold : tc.success;
  const checkColor = scheme === 'dark' ? tc.goldDeep : tc.textInverse;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.center}>
        <View style={s.badgeWrap}>
          <Animated.View
            style={[
              s.ring,
              { backgroundColor: badgeBg, opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
          />
          <Animated.View
            style={[s.badge, { backgroundColor: badgeBg, opacity: pop, transform: [{ scale: pop }] }]}
          >
            <Text style={[s.check, { color: checkColor }]}>✓</Text>
          </Animated.View>
        </View>

        <Animated.Text
          style={[s.title, { opacity: rise, transform: [{ translateY: riseTranslate }] }]}
        >
          {t('quiz:finishing.title')}
        </Animated.Text>
        <Animated.Text style={[s.subtitle, { opacity: rise }]}>
          {t('quiz:finishing.sub')}
        </Animated.Text>
      </View>
    </SafeAreaView>
  );
}

const BADGE = 96;

const makeStyles = (tc: ThemeColors, _scheme: 'light' | 'dark') =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    badgeWrap: {
      width: BADGE,
      height: BADGE,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    ring: {
      position: 'absolute',
      width: BADGE,
      height: BADGE,
      borderRadius: BADGE / 2,
    },
    badge: {
      width: BADGE,
      height: BADGE,
      borderRadius: BADGE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    check: { fontSize: 52, fontWeight: '900', marginTop: -2 },
    title: { fontSize: 26, fontWeight: '800', color: tc.text, textAlign: 'center' },
    subtitle: { fontSize: 14, color: tc.textSecondary, textAlign: 'center', marginTop: 8 },
  });

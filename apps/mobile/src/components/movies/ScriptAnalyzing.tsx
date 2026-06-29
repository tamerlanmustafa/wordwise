/**
 * ScriptAnalyzing — the in-between view shown while a film's script is being
 * turned into a word list (Add-a-film §B). A spinning film-reel mark over the
 * 4-step checklist; each step goes pending (faint) → active (gold spinner) →
 * done (green check). Driven by `activeStep` (see analyzeSteps.phaseToStep)
 * off the real analysis phases, never a fake timer.
 *
 * Honors reduce-motion: the reel + step spinner fall back to a static mark.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_FAMILY } from '../../theme/fonts';
import { ANALYZE_STEPS } from './analyzeSteps';

export interface ScriptAnalyzingProps {
  /** Active checklist index. Steps < this are done; === is active. */
  activeStep: number;
  /** Film title for the "Building your word list for …" line. */
  movieTitle?: string;
}

export function ScriptAnalyzing({ activeStep, movieTitle }: ScriptAnalyzingProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduceMotion(v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        <Animated.View style={[s.reel, !reduceMotion && { transform: [{ rotate }] }]}>
          <View style={[s.reelRing, { borderColor: tc.gold }]} />
          <View style={[s.hub, { backgroundColor: tc.gold }]} />
        </Animated.View>

        <Text style={s.title}>Analyzing the script…</Text>
        {movieTitle ? (
          <Text style={s.sub}>
            Building your word list for <Text style={s.subEm}>{movieTitle}</Text>
          </Text>
        ) : null}

        <View style={s.steps}>
          {ANALYZE_STEPS.map((label, i) => {
            const done = i < activeStep;
            const cur = i === activeStep;
            return (
              <View key={label} style={[s.step, { opacity: done || cur ? 1 : 0.4 }]}>
                <View
                  style={[
                    s.bullet,
                    done && { backgroundColor: tc.success, borderColor: tc.success },
                    cur && { backgroundColor: tc.gold, borderColor: tc.gold },
                  ]}
                >
                  {done ? (
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  ) : cur ? (
                    <ActiveSpinner color={tc.goldDeep} reduceMotion={reduceMotion} />
                  ) : null}
                </View>
                <Text style={[s.stepLabel, { color: done || cur ? tc.text : tc.textFaint, fontWeight: cur ? '800' : '600' }]}>
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

function ActiveSpinner({ color, reduceMotion }: { color: string; reduceMotion: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={!reduceMotion && { transform: [{ rotate }] }}>
      <Ionicons name="sync" size={13} color={color} />
    </Animated.View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: tc.background },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    reel: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
    reelRing: { position: 'absolute', width: 90, height: 90, borderRadius: 45, borderWidth: 3 },
    hub: { width: 18, height: 18, borderRadius: 9 },
    title: { marginTop: 30, fontFamily: SERIF_FAMILY, fontSize: 23, fontWeight: '700', letterSpacing: -0.4, color: tc.text, textAlign: 'center' },
    sub: { marginTop: 8, fontSize: 13.5, color: tc.textSecondary, textAlign: 'center' },
    subEm: { fontStyle: 'italic', color: tc.text },
    steps: { marginTop: 30, width: '100%', gap: 12 },
    step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    bullet: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: tc.border,
      backgroundColor: tc.chipBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepLabel: { fontSize: 14.5 },
  });

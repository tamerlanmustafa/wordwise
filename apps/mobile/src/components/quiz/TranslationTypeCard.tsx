/**
 * TranslationTypeCard — full-card UI for a `type` quiz card.
 *
 * Composes: eyebrow, WordCard, hint chip row (`pos`, `N syllables`,
 * `starts with "X"`), TextInput row, "I don't know · skip" link,
 * correct/revealed callout, sticky bottom CTA.
 *
 * CTA matrix (cf. CLAUDE_PROMPT §7.2):
 *   idle (empty input)   → Check (disabled, chipBg)
 *   typing               → Check (gold)
 *   correct              → Continue → (success green)
 *   revealed (after skip)→ Got it · Continue → (error red)
 *
 * Aliases: we accept `card.translation_aliases` if the backend sends
 * any, plus a normalized fallback (lowercase + trim) on the canonical
 * translation. Proper morphology / diacritic handling is deferred.
 *
 * On wrong-with-content (typed something that doesn't match): we
 * shake the input via Animated `withSequence`-style translateX. We
 * do NOT auto-fail — the user can keep trying until they hit Check
 * (which reveals miss) or Skip.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { WordCard } from './WordCard';
import { HintChip } from './HintChip';

/**
 * Split the example sentence into Text spans so we can highlight every
 * surface form of the target word/lemma. We do a simple stem-prefix
 * match (case-insensitive) — so the lemma "hate" lights up "hated",
 * "hates", "hating" too without needing a full lemmatizer on-device.
 * Cheap and good enough for vocab UI.
 */
function renderExampleWithHighlight(
  sentence: string,
  target: string,
  colors: { base: string; accent: string },
): ReactNode {
  const stem = (target || '').trim().toLowerCase();
  if (!stem) return sentence;
  // Tokenize on word boundaries while preserving spaces + punctuation
  // so the rendered sentence reads naturally.
  const parts = sentence.split(/(\s+|[.,!?;:"'()‘’“”—–-])/);
  return parts.map((part, i) => {
    const lower = part.toLowerCase();
    const isMatch = lower.length >= stem.length && lower.startsWith(stem)
      && /^[a-z]+$/.test(lower);
    return (
      <Text key={i} style={{ color: isMatch ? colors.accent : colors.base, fontWeight: isMatch ? '800' : '600' }}>
        {part}
      </Text>
    );
  });
}

export interface TranslationTypeCardProps {
  word: string;
  /** Canonical translation. Used for exact-match comparison. */
  translation: string;
  /** Optional accepted variants (server-supplied). */
  translationAliases?: string[];
  pos?: string | null;
  example?: string | null;
  /** Optional hint chip hints. When absent, the chip is hidden so the
   *  card degrades cleanly until the backend ships these fields. */
  syllables?: number | null;
  firstLetter?: string | null;
  /** Fires when the user advances past the card (Check → correct, or
   *  Got it after Skip → reveal). `correct=false` for skipped cards. */
  onAnswer: (correct: boolean) => void;
}

type Phase =
  | 'idle'        // input empty
  | 'typing'      // input has content, not yet checked
  | 'correct'     // user typed a match
  | 'revealed';   // user tapped skip; canonical translation is shown

export function TranslationTypeCard({
  word,
  translation,
  translationAliases,
  pos,
  example,
  syllables,
  firstLetter,
  onAnswer,
}: TranslationTypeCardProps) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');

  // Input shake on wrong-with-content. Reanimated would be smoother
  // but Animated covers the 3-pulse sequence we need.
  const shake = useRef(new Animated.Value(0)).current;
  // 220ms green-flash on the input border when the user lands a
  // correct match. We drive a 0→1 progress value and interpolate it
  // into the actual colors at render time so the transition runs even
  // when the phase prop has already flipped to `correct`.
  const correctFlash = useRef(new Animated.Value(0)).current;
  // Entry animation for the correct/revealed callouts — opacity 0→1
  // + translateY 8→0 over 220ms (spec §7.2).
  const calloutAnim = useRef(new Animated.Value(0)).current;

  // Update phase as the user types — keeps the CTA matrix synced.
  useEffect(() => {
    if (phase === 'correct' || phase === 'revealed') return;
    setPhase(value.trim().length === 0 ? 'idle' : 'typing');
  }, [value, phase]);

  const isMatch = useMemo(() => {
    const norm = value.trim().toLowerCase();
    if (!norm) return false;
    if (norm === translation.trim().toLowerCase()) return true;
    if (translationAliases) {
      for (const a of translationAliases) {
        if (typeof a === 'string' && a.trim().toLowerCase() === norm) return true;
      }
    }
    return false;
  }, [value, translation, translationAliases]);

  const runShake = useCallback(() => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 6,  duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 4,  duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -4, duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 2,  duration: 40, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0,  duration: 40, easing: Easing.linear, useNativeDriver: true }),
    ]).start();
  }, [shake]);

  const handleCheckPress = useCallback(() => {
    if (phase === 'correct' || phase === 'revealed') {
      onAnswer(phase === 'correct');
      return;
    }
    if (phase !== 'typing') return;
    if (isMatch) {
      setPhase('correct');
    } else {
      runShake();
    }
  }, [phase, isMatch, runShake, onAnswer]);

  const handleSkipPress = useCallback(() => {
    if (phase === 'correct' || phase === 'revealed') return;
    setPhase('revealed');
    setValue(translation);
  }, [phase, translation]);

  // Drive the correct-flash + callout entry animations whenever phase
  // flips into a terminal state. Both run for 220ms per spec.
  useEffect(() => {
    if (phase === 'correct') {
      correctFlash.setValue(0);
      Animated.timing(correctFlash, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false,
      }).start();
    }
    if (phase === 'correct' || phase === 'revealed') {
      calloutAnim.setValue(0);
      Animated.timing(calloutAnim, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }).start();
    }
  }, [phase, correctFlash, calloutAnim]);

  // ── Visual state derived from phase ─────────────────────────────
  // Revealed (after skip) uses the warning/yellow palette per §7.2 —
  // "yellow callout" — to distinguish "we showed you the answer" from
  // a hard wrong tap. Correct flashes from neutral → success via the
  // 220ms interpolated transition below; we only set the terminal
  // colors directly for the `revealed` branch.
  const revealBg = phase === 'revealed' ? tc.warningTint : tc.paper;
  const revealBorder = phase === 'revealed' ? tc.warningBorder : tc.border;
  const inputBg = phase === 'correct'
    ? correctFlash.interpolate({ inputRange: [0, 1], outputRange: [tc.paper, tc.successTint] })
    : revealBg;
  const inputBorder = phase === 'correct'
    ? correctFlash.interpolate({ inputRange: [0, 1], outputRange: [tc.border, tc.successBorder] })
    : revealBorder;
  const inputFg = phase === 'correct' ? tc.success
                : phase === 'revealed' ? tc.warning
                : tc.text;

  // CTA per matrix.
  const ctaState: 'disabled' | 'gold' | 'success' | 'error' =
    phase === 'idle'    ? 'disabled'
  : phase === 'typing'  ? 'gold'
  : phase === 'correct' ? 'success'
  :                       'error';
  const ctaBg =
    ctaState === 'disabled' ? tc.chipBg
  : ctaState === 'gold'     ? tc.gold
  : ctaState === 'success'  ? tc.success
  :                           tc.error;
  const ctaFg =
    ctaState === 'disabled' ? tc.textFaint
  : ctaState === 'gold'     ? tc.goldDeep
  :                           '#fff';
  const ctaLabel =
    ctaState === 'disabled' || ctaState === 'gold' ? 'Check'
  : ctaState === 'success'                          ? 'Continue →'
  :                                                  'Got it · Continue →';
  const ctaEnabled = ctaState !== 'disabled';
  const ctaBorder = ctaState === 'disabled' ? tc.border : 'transparent';

  // Build the hint chips lazily — only show those the payload carries.
  const hintLabels: string[] = [];
  if (pos) hintLabels.push(`${pos.replace(/\.$/, '')}.`);
  if (typeof syllables === 'number' && syllables > 0) {
    hintLabels.push(`${syllables} ${syllables === 1 ? 'syllable' : 'syllables'}`);
  }
  if (firstLetter) hintLabels.push(`starts with "${firstLetter}"`);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>TYPE THE TRANSLATION</Text>
        {/* Hide `example` on the word card so it doesn't reveal the
            answer before the user types — we surface the sentence in
            its own IN CONTEXT callout below once they've answered. */}
        <WordCard word={word} pos={pos} example={null} size={34} />

        {hintLabels.length > 0 ? (
          <View style={s.hintRow}>
            {hintLabels.map((h, i) => (
              <HintChip key={`${h}-${i}`} label={h} />
            ))}
          </View>
        ) : null}

        <Animated.View
          style={[
            s.inputRow,
            {
              transform: [{ translateX: shake }],
              backgroundColor: inputBg,
              borderColor: inputBorder,
            },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Type the translation…"
            placeholderTextColor={tc.textFaint}
            editable={phase !== 'correct' && phase !== 'revealed'}
            style={[s.input, { color: inputFg }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleCheckPress}
          />
          {phase === 'correct' ? (
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={tc.success} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M5 12l4 4 10-10" />
            </Svg>
          ) : null}
        </Animated.View>

        {phase === 'idle' || phase === 'typing' ? (
          <Pressable onPress={handleSkipPress} hitSlop={8} style={s.skipWrap}>
            <Text style={s.skipText}>I don't know · skip</Text>
          </Pressable>
        ) : null}

        {phase === 'correct' ? (
          <Animated.View
            style={[
              s.correctCallout,
              {
                opacity: calloutAnim,
                transform: [{
                  translateY: calloutAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                }],
              },
            ]}
          >
            <Text style={s.correctEyebrow}>CORRECT!</Text>
            <Text style={s.correctBody}>Added to your known words. +5 XP</Text>
          </Animated.View>
        ) : null}

        {phase === 'revealed' ? (
          <Animated.View
            style={[
              s.revealedCallout,
              {
                opacity: calloutAnim,
                transform: [{
                  translateY: calloutAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                }],
              },
            ]}
          >
            <Text style={s.revealedEyebrow}>SHOWED YOU</Text>
            <Text style={s.revealedBody}>
              <Text style={s.revealedAnswer}>{translation}</Text>
              {' — counted as a miss so it surfaces again soon.'}
            </Text>
          </Animated.View>
        ) : null}

        {(phase === 'correct' || phase === 'revealed') && example ? (
          <Animated.View
            style={[
              s.contextCallout,
              {
                opacity: calloutAnim,
                transform: [{
                  translateY: calloutAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                }],
              },
            ]}
          >
            <Text style={s.contextEyebrow}>IN CONTEXT</Text>
            <Text style={s.contextBody}>
              {renderExampleWithHighlight(example, word, {
                base: s.contextBody.color as string,
                accent: phase === 'correct' ? s.contextAccentCorrect.color as string : s.contextAccentRevealed.color as string,
              })}
            </Text>
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* Sticky CTA */}
      <View style={s.ctaBar}>
        <Pressable
          onPress={ctaEnabled ? handleCheckPress : undefined}
          style={({ pressed }) => [
            s.cta,
            {
              backgroundColor: ctaBg,
              borderWidth: ctaState === 'disabled' ? 1 : 0,
              borderColor: ctaBorder,
            },
            ctaEnabled && pressed && { opacity: 0.9 },
            ctaState === 'success' && s.ctaShadow,
            ctaState === 'error' && s.ctaShadow,
          ]}
        >
          <Text style={[s.ctaText, { color: ctaFg }]}>{ctaLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
    },
    body: {
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 24,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.8,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginTop: 6,
    },
    hintRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      justifyContent: 'center',
      marginBottom: 14,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderRadius: 14,
      borderWidth: 2,
    },
    input: {
      flex: 1,
      fontSize: 18,
      fontWeight: '600',
      paddingVertical: 0,
    },
    skipWrap: {
      alignItems: 'center',
      marginTop: 14,
    },
    skipText: {
      fontSize: 12,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: tc.textFaint,
    },
    correctCallout: {
      marginTop: 22,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tc.successTint,
      borderWidth: 1,
      borderColor: tc.successBorder,
    },
    correctEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      color: tc.success,
      textTransform: 'uppercase',
    },
    correctBody: {
      fontSize: 13,
      fontWeight: '600',
      color: tc.text,
      marginTop: 4,
    },
    revealedCallout: {
      marginTop: 22,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tc.warningTint,
      borderWidth: 1,
      borderColor: tc.warningBorder,
    },
    revealedEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      color: tc.warning,
      textTransform: 'uppercase',
    },
    revealedBody: {
      fontSize: 13,
      fontWeight: '600',
      color: tc.text,
      marginTop: 4,
    },
    revealedAnswer: {
      color: tc.text,
      fontWeight: '800',
    },
    contextCallout: {
      marginTop: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tc.paper,
      borderWidth: 1,
      borderColor: tc.border,
    },
    contextEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
    },
    contextBody: {
      fontSize: 14,
      fontWeight: '600',
      color: tc.text,
      marginTop: 6,
      lineHeight: 20,
      fontStyle: 'italic',
    },
    contextAccentCorrect: {
      color: tc.success,
    },
    contextAccentRevealed: {
      color: tc.warning,
    },
    ctaBar: {
      paddingHorizontal: 18,
      paddingTop: 12,
      paddingBottom: 24,
      borderTopWidth: 1,
      borderTopColor: tc.divider,
      backgroundColor: tc.background,
    },
    cta: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 14,
      alignItems: 'center',
    },
    ctaShadow: {
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 6,
    },
    ctaText: {
      fontSize: 14,
      fontWeight: '900',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });

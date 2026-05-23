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

  // ── Visual state derived from phase ─────────────────────────────
  const inputBg = phase === 'correct' ? tc.successTint
                : phase === 'revealed' ? tc.errorTint
                : tc.paper;
  const inputBorder = phase === 'correct' ? tc.successBorder
                    : phase === 'revealed' ? tc.errorBorder
                    : tc.border;
  const inputFg = phase === 'correct' ? tc.success
                : phase === 'revealed' ? tc.error
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
        <WordCard word={word} pos={pos} example={example} size={34} />

        {hintLabels.length > 0 ? (
          <View style={s.hintRow}>
            {hintLabels.map((h, i) => (
              <HintChip key={`${h}-${i}`} label={h} />
            ))}
          </View>
        ) : null}

        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          <View
            style={[
              s.inputRow,
              { backgroundColor: inputBg, borderColor: inputBorder },
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
          </View>
        </Animated.View>

        {phase === 'idle' || phase === 'typing' ? (
          <Pressable onPress={handleSkipPress} hitSlop={8} style={s.skipWrap}>
            <Text style={s.skipText}>I don't know · skip</Text>
          </Pressable>
        ) : null}

        {phase === 'correct' ? (
          <View style={s.correctCallout}>
            <Text style={s.correctEyebrow}>CORRECT!</Text>
            <Text style={s.correctBody}>Added to your known words. +5 XP</Text>
          </View>
        ) : null}

        {phase === 'revealed' ? (
          <View style={s.revealedCallout}>
            <Text style={s.revealedEyebrow}>SHOWED YOU</Text>
            <Text style={s.revealedBody}>
              <Text style={s.revealedAnswer}>{translation}</Text>
              {' — counted as a miss so it surfaces again soon.'}
            </Text>
          </View>
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
      backgroundColor: tc.errorTint,
      borderWidth: 1,
      borderColor: tc.errorBorder,
    },
    revealedEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.4,
      color: tc.error,
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

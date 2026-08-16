/**
 * WordCard — one full-viewport card in the Explore feed.
 *
 * Layout, top → bottom:
 *   1. Meta row (CEFR badge + part of speech). Pinned — it must NOT move
 *      when a panel opens, so it sits outside the lifting group.
 *   2. flex spacer
 *   3. Lifting group: word → IPA → section rule → sentence → translation.
 *      Transforms as one unit so the word rises clear of an open panel.
 *   4. flex spacer
 *
 * Tapping anywhere toggles the translation — word and sentence together,
 * never one without the other. There is no reveal button and no hint text.
 *
 * The definition line the design calls for is absent by decision: nothing in
 * the data model carries a learner gloss (`lemmas` has no definition column,
 * `words.definition` is empty), so rather than render a mostly-blank row the
 * card goes word → sentence. Wiring a gloss in later is one <Text> here.
 *
 * Motion note: the reveal animates height on the JS driver (RN can't drive
 * layout natively) while opacity + translateY run on the native driver, so
 * the block unfolds and the surrounding content glides to its new centre.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import type { FeedItem } from '../../services/api';

const SERIF_FAMILY = 'Source Serif 4';

/** The shared curve for every Explore movement. */
export const EXPLORE_EASING = Easing.bezier(0.22, 0.75, 0.28, 1);

interface Props {
  item: FeedItem;
  height: number;
  /** 0 = at rest, 1 = a panel is open and the group should be lifted. */
  lift: Animated.Value;
  revealed: boolean;
  onToggleReveal: () => void;
  /** How far the lifting group rises when a panel opens, and the rail's
   *  lane width — both scale with the viewport (see explore/metrics). */
  liftDistance: number;
  lane: number;
}

function WordCardBase({
  item,
  height,
  lift,
  revealed,
  onToggleReveal,
  liftDistance,
  lane,
}: Props) {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  // Height needs a real measurement to animate to; until we have one the
  // block renders off-screen once to be measured.
  const [revealHeight, setRevealHeight] = useState(0);
  const heightAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heightAnim, {
        toValue: revealed ? 1 : 0,
        duration: 340,
        easing: EXPLORE_EASING,
        useNativeDriver: false,
      }),
      Animated.timing(fadeAnim, {
        toValue: revealed ? 1 : 0,
        duration: 260,
        easing: EXPLORE_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [revealed, heightAnim, fadeAnim]);

  const liftStyle = {
    transform: [
      {
        translateY: lift.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -liftDistance],
        }),
      },
    ],
  };

  const hasTranslation = Boolean(item.translated_word || item.translated_sentence);

  return (
    <Pressable
      style={[s.card, { height, paddingEnd: lane }]}
      onPress={onToggleReveal}
      // The whole card is the reveal target, so it should read as one
      // control rather than announcing every line separately.
      accessibilityRole="button"
      accessibilityLabel={item.word}
      accessibilityHint={revealed ? 'Hide translation' : 'Show translation'}
    >
      {/* 1. Meta row — pinned, deliberately outside the lifting group. */}
      <View style={s.metaRow}>
        {item.cefr ? (
          <View style={s.badge}>
            <Text style={s.badgeText}>{item.cefr}</Text>
          </View>
        ) : null}
        {item.pos ? <Text style={s.pos}>{item.pos}</Text> : null}
      </View>

      <View style={s.spacerTop} />

      {/* 3. Lifting group. */}
      <Animated.View style={liftStyle}>
        <Text style={s.word} allowFontScaling={false}>
          {item.word}
        </Text>

        {item.ipa ? <Text style={s.ipa}>{item.ipa}</Text> : null}

        <View style={s.ruleRow}>
          <Text style={s.caption} numberOfLines={1}>
            EXAMPLE SENTENCE
          </Text>
          <View style={s.hairline} />
        </View>

        <Sentence item={item} s={s} />

        {hasTranslation ? (
          <>
            <Animated.View
              style={{
                height: heightAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, revealHeight],
                }),
                marginTop: heightAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 18],
                }),
                overflow: 'hidden',
              }}
              pointerEvents={revealed ? 'auto' : 'none'}
            >
              <Animated.View
                style={{
                  opacity: fadeAnim,
                  transform: [
                    {
                      translateY: fadeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, 0],
                      }),
                    },
                  ],
                }}
              >
                <TranslationBlock item={item} s={s} />
              </Animated.View>
            </Animated.View>

            {/* Measurement pass: laid out but never visible, so the
                animated container knows what height to open to. */}
            {revealHeight === 0 ? (
              <View
                style={s.measure}
                pointerEvents="none"
                onLayout={(e) => setRevealHeight(e.nativeEvent.layout.height)}
              >
                <TranslationBlock item={item} s={s} />
              </View>
            ) : null}
          </>
        ) : null}
      </Animated.View>

      <View style={s.spacerBottom} />
    </Pressable>
  );
}

/** The example sentence with the inflected target form gold-washed.
 *  Offsets come from the server (`sentence_match`) so the client never
 *  has to guess which surface form to highlight. */
function Sentence({ item, s }: { item: FeedItem; s: Styles }) {
  const match = item.sentence_match;
  if (
    !match ||
    match.start < 0 ||
    match.end > item.sentence.length ||
    match.start >= match.end
  ) {
    return <Text style={s.sentence}>{item.sentence}</Text>;
  }
  return (
    <Text style={s.sentence}>
      {item.sentence.slice(0, match.start)}
      <Text style={s.sentenceTarget}>
        {item.sentence.slice(match.start, match.end)}
      </Text>
      {item.sentence.slice(match.end)}
    </Text>
  );
}

function TranslationBlock({ item, s }: { item: FeedItem; s: Styles }) {
  return (
    <View style={s.translation}>
      {item.translated_word ? (
        <Text style={s.translatedWord}>{item.translated_word}</Text>
      ) : null}
      {item.translated_sentence ? (
        <Text style={s.translatedSentence}>{item.translated_sentence}</Text>
      ) : null}
    </View>
  );
}

export const WordCard = memo(WordCardBase);

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    card: {
      // paddingEnd is supplied per-render: it's the action rail's lane, so
      // text never runs underneath the glyphs.
      paddingTop: 18,
      paddingBottom: 20,
      paddingStart: 24,
      backgroundColor: tc.feedBg,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    badge: {
      paddingVertical: 4,
      paddingHorizontal: 9,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: tc.goldLine,
    },
    badgeText: {
      fontSize: 10.5,
      fontWeight: '900',
      letterSpacing: 1,
      color: tc.goldOnSurface,
    },
    pos: {
      fontFamily: SERIF_FAMILY,
      fontStyle: 'italic',
      fontSize: 14,
      color: tc.textFaint,
    },
    spacerTop: { flex: 1, minHeight: 12 },
    spacerBottom: { flex: 1, minHeight: 14 },
    word: {
      fontFamily: SERIF_FAMILY,
      fontSize: 46,
      fontWeight: '700',
      letterSpacing: -1.2,
      lineHeight: 46 * 1.05,
      color: tc.text,
    },
    ipa: {
      marginTop: 7,
      fontSize: 13.5,
      color: tc.textFaint,
    },
    ruleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 18,
      marginBottom: 14,
      gap: 10,
    },
    caption: {
      fontSize: 9,
      fontWeight: '500',
      letterSpacing: 1.5,
      color: tc.textFaint,
      // No wrap: the hairline takes whatever is left of the row.
      flexShrink: 0,
    },
    hairline: {
      flex: 1,
      height: 1,
      backgroundColor: tc.border,
    },
    sentence: {
      fontFamily: SERIF_FAMILY,
      fontSize: 20,
      lineHeight: 20 * 1.55,
      color: tc.text,
    },
    sentenceTarget: {
      color: tc.goldOnSurface,
      fontWeight: '600',
      backgroundColor: tc.goldWash,
    },
    translation: {
      borderStartWidth: 3,
      borderStartColor: tc.gold,
      paddingStart: 14,
    },
    translatedWord: {
      fontFamily: SERIF_FAMILY,
      fontSize: 22,
      fontWeight: '600',
      color: tc.goldOnSurface,
    },
    translatedSentence: {
      marginTop: 8,
      fontSize: 16,
      lineHeight: 16 * 1.5,
      color: tc.textSecondary,
    },
    measure: {
      position: 'absolute',
      opacity: 0,
      left: 0,
      right: 0,
      top: 0,
    },
  });

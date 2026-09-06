/**
 * WordCard — one full-viewport card in the Explore feed.
 *
 * Layout, top → bottom:
 *   1. Meta row (CEFR badge). Pinned — it must NOT move when a panel opens,
 *      so it sits outside the lifting group.
 *   2. flex spacer
 *   3. Lifting group: word → IPA → gloss → section rule → sentence →
 *      translation. Transforms as one unit so the word rises clear of an
 *      open panel.
 *   4. flex spacer
 *
 * Tapping anywhere toggles the translation — word and sentence together,
 * never one without the other. There is no reveal button and no hint text.
 *
 * The gloss line sits between the word and the section rule and reads
 * "(noun) a person who…" — the part of speech and the definition, both from
 * `lemmas`, composed by `glossLine`. Either half can be missing (the parser
 * had no tag; the definition worker hasn't reached the lemma), and the line
 * renders whatever it has; with neither it disappears and the card goes word →
 * sentence exactly as it did before the column existed.
 *
 * The part of speech is here rather than in the meta row because it belongs to
 * the definition, not to the card's chrome: it says which sense the gloss
 * describes. Printing it in both places would say the same word twice on one
 * card.
 *
 * The line is deliberately NOT part of the reveal: it is English, describing
 * the same sense the sentence uses, so it belongs with the always-visible half
 * of the card, not behind the tap that shows the learner's own language.
 *
 * Motion note: the reveal animates height on the JS driver (RN can't drive
 * layout natively) while opacity + translateY run on the native driver, so
 * the block unfolds and the surrounding content glides to its new centre.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { SERIF_ITALIC_FAMILY, opticalSize } from '../../theme/fonts';
import { glossLine } from '../../utils/glossLine';
import { pronounce } from '../../utils/pronunciation';
import { useIsPremium } from '../../stores/entitlementsStore';
import { showToast } from '../../stores/toastStore';
import { SpeakerIcon } from '../ui/icons';
import { CARD_PADDING_START, SPEAKER_GAP, wordRowLayout } from './wordRowLayout';
import type { FeedItem } from '../../services/api';

/** Big enough to read beside display type without competing with it. */
const SPEAKER_SIZE = 22;

/**
 * Extra margin around the chip.
 *
 * Small now, and deliberately so: the chip is already a 44pt target, and the
 * slop used to be the *only* thing making the 22pt glyph tappable. Uncapped on
 * every side — this speaker has no icon neighbours to steal taps from, only the
 * card-wide reveal Pressable underneath it, which is exactly what it is
 * protecting the user from hitting by accident.
 */
const SPEAKER_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * How far the renderer may shrink the word past our own floor.
 *
 * The computed size does the work; this is the backstop for the pathological
 * case — a 21-letter lemma on a 4.7" screen, where even `WORD_SIZE_MIN`
 * overflows the lane. Truncating is not an option the design allows, so the
 * last few points come from the platform.
 */
const WORD_MIN_SCALE = 0.8;

// Not a font the app ships or loads, so every line using it resolves to the
// platform's default face. Left alone here because changing it would restyle
// the whole card; the gloss below asks theme/fonts for a real installed face
// instead, which is the only way `fontStyle: 'italic'` gets a true italic.
const SERIF_FAMILY = 'Source Serif 4';

/**
 * The gloss is the one line on this card in a real, named family, so it is the
 * one line that has to be sized against its neighbours rather than at a round
 * number. Everything around it renders in the platform face — SF on iOS, whose
 * lowercase is TALLER than Charter's, and Roboto on Android, whose lowercase is
 * slightly shorter than Noto Serif's — so the correction runs in opposite
 * directions on the two platforms: 17 becomes ~17.8 on iOS and ~16.8 on
 * Android, and the line looks the same size as the word above it on both.
 *
 * Safe to resize here, unlike the card deck: this card centres a lifting group
 * between two flex spacers instead of seating the gloss in a fixed slot.
 */
const GLOSS_SIZE = opticalSize(17, 'serifItalic', 'sans');

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
  const { t } = useTranslation();
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  // Premium-gated, matching the vocabulary rows and the card deck — the
  // speaker is one feature with one entitlement, not three.
  const isPremium = useIsPremium();
  const [playing, setPlaying] = useState(false);

  // The headword's size is a function of the string and the device, not a
  // constant: the usable width is the screen minus the card's padding and the
  // action rail's lane, and both the word and the lane vary.
  const { width } = useWindowDimensions();
  const wordRow = useMemo(
    () => wordRowLayout({ word: item.word, width, lane, hasSpeaker: isPremium }),
    [item.word, width, lane, isPremium],
  );

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
  const gloss = glossLine(item.pos, item.definition);

  const handlePronounce = async () => {
    if (playing) return;
    setPlaying(true);
    // Shared with the vocabulary rows and the card deck: the bearer token this
    // endpoint requires is decided in one place, not per component.
    const result = await pronounce(item.word);
    setPlaying(false);
    if (result === 'failed') showToast({ tone: 'error', message: t('vocabulary:pronounceFailed') });
    else if (result === 'muted') showToast({ message: t('vocabulary:pronounceMuted') });
  };

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
      </View>

      <View style={s.spacerTop} />

      {/* 3. Lifting group. */}
      <Animated.View style={liftStyle}>
        {/* Word + speaker, always on one line. The size is computed from the
            string and the device (see wordRowLayout) rather than fixed, so a
            21-character lemma shrinks instead of wrapping and dragging the
            speaker away from the word it belongs to. `adjustsFontSizeToFit` is
            only the backstop for the pathological case, and it needs the
            explicit `maxWidth` to have anything to shrink against. */}
        <View style={s.wordRow}>
          <Text
            style={[
              s.word,
              {
                fontSize: wordRow.fontSize,
                lineHeight: wordRow.lineHeight,
                letterSpacing: wordRow.letterSpacing,
                maxWidth: wordRow.available,
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={WORD_MIN_SCALE}
            allowFontScaling={false}
          >
            {item.word}
          </Text>
          {isPremium ? (
            <TouchableOpacity
              onPress={(e) => {
                // The whole card is the reveal target; without this a tap on
                // the speaker would also flip the translation.
                e.stopPropagation();
                void handlePronounce();
              }}
              hitSlop={SPEAKER_HIT_SLOP}
              style={[
                s.speaker,
                { width: wordRow.chipSize, height: wordRow.chipSize, borderRadius: wordRow.chipSize / 2 },
                playing && s.speakerPlaying,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('vocabulary:row.pronounce')}
            >
              <SpeakerIcon
                size={SPEAKER_SIZE}
                playing={playing}
                color={playing ? tc.goldDeep : tc.goldOnSurface}
              />
            </TouchableOpacity>
          ) : null}
        </View>

        {item.ipa ? <Text style={s.ipa}>{item.ipa}</Text> : null}

        {/* Clamped, because this card has no fixed slots — it centres a
            lifting group between two flex spacers, so an unclamped gloss would
            eat the spacers and on a short viewport push the sentence past the
            bottom edge.

            Three, not the deck's two: the clamp here is a backstop against a
            pathological value, not a squeeze. The usable width is the card
            minus 24 and the action rail's lane (~300pt), which at 17pt seats
            roughly 40 characters a line — so MAX_DEF_CHARS (90) plus the label
            needs a third line to land whole on an SE. The deck can afford two
            because its slot runs at 12pt.

            One Text, not a row: the label has to wrap with the gloss rather
            than sit beside it, or a long definition would flow underneath it
            in a column of its own width. */}
        {gloss ? (
          <Text style={s.definition} numberOfLines={3}>
            {gloss.pos ? <Text style={s.glossPos}>{gloss.pos}</Text> : null}
            {gloss.pos && gloss.definition ? ' ' : null}
            {gloss.definition}
          </Text>
        ) : null}

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
      // From wordRowLayout, which subtracts it when sizing the headword —
      // stated once so the maths and the padding cannot drift apart.
      paddingStart: CARD_PADDING_START,
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
    spacerTop: { flex: 1, minHeight: 12 },
    spacerBottom: { flex: 1, minHeight: 14 },
    wordRow: {
      flexDirection: 'row',
      // Centre, now that the word is guaranteed to be one line: the chip sits
      // on the word's optical middle at every size, with no offset to keep in
      // step with a font size that is no longer a constant.
      alignItems: 'center',
    },
    word: {
      // Shrink, don't grow. `flex: 1` would push the speaker to the card's
      // trailing edge and break the "beside the word" reading.
      flexShrink: 1,
      fontFamily: SERIF_FAMILY,
      fontWeight: '700',
      color: tc.text,
      // fontSize, lineHeight, letterSpacing and maxWidth are supplied per
      // render — they are functions of the word and the screen.
    },
    speaker: {
      marginStart: SPEAKER_GAP,
      alignItems: 'center',
      justifyContent: 'center',
      // The word yields, never the tap target: the whole point of the chip is
      // a size a thumb can hit, and a squeezed one would put us back where we
      // started.
      flexShrink: 0,
      // A filled chip, not a bare glyph on the card ground. It was `textFaint`,
      // which is the app's quietest ink — nearly invisible in both themes on a
      // card whose whole job is one loud word — and it read as decoration
      // rather than as something to press. Gold is the app's one accent, and
      // both tokens are theme-aware: the wash and the hairline invert with the
      // ground while the ink stays legible on either.
      backgroundColor: tc.goldWash,
      borderWidth: 1,
      borderColor: tc.goldLine,
    },
    speakerPlaying: {
      // Filled while it speaks, so the state is visible from across the room
      // rather than only in the icon's own animation.
      backgroundColor: tc.gold,
      borderColor: tc.gold,
    },
    ipa: {
      marginTop: 7,
      fontSize: 13.5,
      color: tc.textFaint,
    },
    definition: {
      marginTop: 10,
      fontFamily: SERIF_ITALIC_FAMILY,
      fontSize: GLOSS_SIZE,
      lineHeight: GLOSS_SIZE * 1.45,
      // Italic and secondary so it reads as commentary on the word above it
      // rather than as a second sentence competing with the example below.
      fontStyle: 'italic',
      color: tc.textSecondary,
    },
    glossPos: {
      // Upright inside the italic line, and gold: the dictionary treatment,
      // and the one thing on the card that names a grammatical fact rather
      // than a meaning. `fontStyle` has to be reset explicitly — a nested
      // Text inherits the parent's italic otherwise.
      fontStyle: 'normal',
      fontWeight: '600',
      color: tc.goldOnSurface,
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

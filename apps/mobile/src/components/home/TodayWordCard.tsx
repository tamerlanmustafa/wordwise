import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { wordwiseApi, type TodaysWord } from '../../services/api';
import { useDoubleTap } from '../../hooks/useDoubleTap';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { Skeleton } from '../ui/Skeleton';
import { HomeIcon } from './HomeIcons';

/**
 * TodayWordCard — "Today's Word" on the redesigned Home.
 *
 * Re-skinned into the cinema paper system (paper card, 1px border, soft
 * shadow; gold eyebrow; serif word) to match My Movies / Practice. The
 * tap-to-flip → translation behaviour is preserved: the real `TodaysWord`
 * payload carries no definition/pos, so the back face (translated word +
 * translated example) is the card's substance. Front face shows the word,
 * its CEFR level, the example sentence, and a Save button with a stroked
 * bookmark icon (→ stroked check + success tint when saved). No emoji /
 * ★☆ glyphs survive.
 */

const SERIF_FAMILY = 'Source Serif 4';
const CARD_HEIGHT = 152;
const FACE_PADDING = 18;

interface Props {
  word: TodaysWord;
  targetLanguage: string;
}

const _TodayWordCard = ({ word, targetLanguage }: Props) => {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const flipCount = useRef(0);
  const [showingFront, setShowingFront] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(word.translated_word ?? null);
  const sentence = word.example_sentence ?? null;
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(
    word.translated_sentence ?? null
  );

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: ['0deg', '180deg', '360deg', '540deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: ['180deg', '360deg', '540deg', '720deg'],
  });

  const handleSave = async (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    if (saving) return;
    setSaving(true);
    setSaved(prev => !prev);
    try {
      // Today's word is movie-independent, so the save is a global save.
      const res = await wordwiseApi.saveWord(word.word);
      setSaved(res.saved);
    } catch {
      setSaved(prev => !prev);
    }
    setSaving(false);
  };

  const prefetchBackside = () => {
    const needWord = !translation;
    const needSentence = !!sentence && !sentenceTranslation;
    if (!needWord && !needSentence) return;
    setTranslating(true);
    const tasks: Promise<unknown>[] = [];
    if (needWord) {
      tasks.push(
        wordwiseApi
          .translate(word.word, targetLanguage)
          .then(res => setTranslation(res.translated))
          .catch(() => {})
      );
    }
    if (needSentence && sentence) {
      tasks.push(
        wordwiseApi
          .translate(sentence, targetLanguage)
          .then(res => setSentenceTranslation(res.translated))
          .catch(() => {})
      );
    }
    Promise.all(tasks).finally(() => setTranslating(false));
  };

  useEffect(() => { prefetchBackside(); }, []);

  const handleFlip = () => {
    const next = flipCount.current + 1;
    flipCount.current = next;
    const isFlippingToBack = next % 2 === 1;
    setTimeout(() => setShowingFront(!isFlippingToBack), 210);

    Animated.timing(flipAnim, {
      toValue: next,
      duration: 420,
      useNativeDriver: true,
    }).start();

    if (isFlippingToBack) prefetchBackside();
  };

  const isSameAsWord = (t: string) => t.trim().toLowerCase() === word.word.toLowerCase();
  const onDoubleTapFlip = useDoubleTap(handleFlip);

  return (
    <View style={s.container}>
      {/* FRONT face */}
      <Animated.View
        pointerEvents={showingFront ? 'auto' : 'none'}
        style={[s.face, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}
      >
        <View style={s.header}>
          <Text style={s.eyebrow}>WORD OF THE HOUR</Text>
        </View>
        <View style={s.wordRow}>
          <Pressable onPress={onDoubleTapFlip} style={s.wordPressable}>
            <Text style={s.word} numberOfLines={1}>{word.word}</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            hitSlop={14}
            style={s.starBtn}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Saved to your words' : 'Save this word'}
          >
            <HomeIcon name="star" size={24} color={saved ? tc.gold : tc.textFaint} />
          </Pressable>
        </View>
        <Pressable onPress={onDoubleTapFlip} style={s.flipZone} />
        <View style={s.frontFooter}>
          {word.cefr_level ? <Text style={s.level}>{word.cefr_level}</Text> : <View />}
          <Text style={s.hint}>Double tap to flip</Text>
        </View>
      </Animated.View>

      {/* BACK face */}
      <Animated.View
        pointerEvents={showingFront ? 'none' : 'auto'}
        style={[s.face, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
      >
        <View style={s.header}>
          <Text style={s.eyebrow}>WORD OF THE HOUR</Text>
        </View>
        <Pressable onPress={onDoubleTapFlip} style={s.flipZone}>
          {translating ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="small" color={tc.goldOnSurface} />
            </View>
          ) : (
            <View>
              {translation && !isSameAsWord(translation) ? (
                <Text style={s.translationWord} numberOfLines={1}>{translation}</Text>
              ) : null}
              {sentence ? (
                <View>
                  <Text style={s.sentence} numberOfLines={3}>"{sentence.replace(/\n/g, ' ')}"</Text>
                  {sentenceTranslation ? (
                    <Text style={s.sentenceTranslation} numberOfLines={2}>
                      {sentenceTranslation.replace(/\n/g, ' ')}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
};

export const TodayWordCard = memo(_TodayWordCard);

export const TodayWordCardSkeleton = () => {
  const tc = useThemeColors();
  const s = useMemo(() => makeStyles(tc), [tc]);
  return (
    <View style={s.container}>
      <View style={[s.face, s.skeletonFace]}>
        <View style={s.header}>
          <Skeleton width={90} height={10} radius={7} color={tc.divider} />
          <Skeleton width={80} height={10} radius={7} color={tc.divider} />
        </View>
        <Skeleton width="55%" height={30} radius={7} color={tc.divider} style={s.skeletonWord} />
        <Skeleton width="80%" height={13} radius={7} color={tc.divider} />
      </View>
    </View>
  );
};

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: {
      alignSelf: 'stretch',
      marginHorizontal: 18,
      marginTop: 4,
      marginBottom: 16,
      height: CARD_HEIGHT,
      borderRadius: 14,
    },
    face: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: tc.paper,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: tc.border,
      backfaceVisibility: 'hidden',
      overflow: 'hidden',
      padding: FACE_PADDING,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    skeletonFace: {
      position: 'relative',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '900',
      color: tc.goldOnSurface,
      textTransform: 'uppercase',
      letterSpacing: 1.8,
    },
    level: {
      fontSize: 11,
      fontWeight: '700',
      color: tc.textSecondary,
      letterSpacing: 0.6,
    },
    hint: {
      fontSize: 12,
      color: tc.textFaint,
      fontWeight: '600',
    },
    wordRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    wordPressable: {
      flexShrink: 1,
    },
    starBtn: {
      paddingLeft: 8,
      paddingVertical: 4,
    },
    word: {
      flexShrink: 1,
      fontFamily: SERIF_FAMILY,
      fontSize: 30,
      fontWeight: '700',
      color: tc.text,
      letterSpacing: -0.6,
    },
    flipZone: {
      flex: 1,
    },
    frontFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sentence: {
      fontSize: 13,
      color: tc.textSecondary,
      fontStyle: 'italic',
      lineHeight: 18,
    },
    translationWord: {
      fontFamily: SERIF_FAMILY,
      fontSize: 26,
      fontWeight: '700',
      color: tc.text,
      letterSpacing: -0.4,
      marginBottom: 1,
    },
    sentenceTranslation: {
      fontSize: 12,
      color: tc.textFaint,
      lineHeight: 16,
      marginTop: 6,
    },
    loadingBox: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    skeletonWord: {
      marginTop: 12,
      marginBottom: 12,
    },
  });

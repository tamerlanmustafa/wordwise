import React, { memo, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { wordwiseApi, API_BASE_URL, type TodaysWord } from '../../services/api';
import { useDoubleTap } from '../../hooks/useDoubleTap';

const CARD_HEIGHT = 148;
const FACE_PADDING = 16;

interface Props {
  word: TodaysWord;
  targetLanguage: string;
}

const _TodayWordCard = ({ word, targetLanguage }: Props) => {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const flipCount = useRef(0);
  const [showingFront, setShowingFront] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sentence, setSentence] = useState<string | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: ['0deg', '180deg', '360deg', '540deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1, 2, 3],
    outputRange: ['180deg', '360deg', '540deg', '720deg'],
  });

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(prev => !prev);
    try {
      const res = await wordwiseApi.saveWord(word.word, word.movie_id);
      setSaved(res.saved);
    } catch {
      setSaved(prev => !prev);
    }
    setSaving(false);
  };

  const prefetchBackside = () => {
    if (translation) return;
    setTranslating(true);
    Promise.all([
      wordwiseApi.translate(word.word, targetLanguage, undefined, word.movie_id),
      fetch(
        `${API_BASE_URL}/api/enrichment/movies/${word.movie_id}/sentences/${encodeURIComponent(word.word)}?max_examples=1&target_lang=${encodeURIComponent(targetLanguage)}`
      )
        .then(r => r.json())
        .then(data => {
          const ex = data.sentences?.[0];
          if (ex) {
            setSentence(ex.sentence ?? null);
            setSentenceTranslation(ex.translation ?? null);
          }
        })
        .catch(() => {}),
    ])
      .then(([res]) => setTranslation(res.translated))
      .catch(() => {})
      .finally(() => setTranslating(false));
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
        {/* header outside flip zone — reload works without flipping */}
        <View style={s.header}>
          <Text style={s.label}>Today's Word</Text>
          <Text style={s.movie} numberOfLines={1}>from {word.movie_title}</Text>
        </View>
        {/* word + star as siblings — no nesting, no propagation issues */}
        <View style={s.wordRow}>
          <Pressable onPress={onDoubleTapFlip} style={s.wordPressable}>
            <Text style={s.word}>{word.word}</Text>
          </Pressable>
          <Pressable onPress={handleSave} hitSlop={14} style={s.starBtn}>
            <Text style={[s.star, saved && s.starSaved]}>{saved ? '★' : '☆'}</Text>
          </Pressable>
        </View>
        <Pressable onPress={onDoubleTapFlip} style={s.flipZone}>
          <Text style={s.hint}>Double tap to flip</Text>
        </Pressable>
      </Animated.View>

      {/* BACK face */}
      <Animated.View
        pointerEvents={showingFront ? 'none' : 'auto'}
        style={[s.face, s.back, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
      >
        <View style={s.header}>
          <Text style={s.label}>Translation</Text>
          <Text style={s.movie} numberOfLines={1}>from {word.movie_title}</Text>
        </View>
        <Pressable onPress={onDoubleTapFlip} style={s.flipZone}>
          {translating ? (
            <View style={s.loadingBox}>
              <ActivityIndicator size="small" color="#7C5CBF" />
            </View>
          ) : (
            <View>
              {translation && !isSameAsWord(translation) && (
                <View><Text style={s.translationWord}>{translation}</Text></View>
              )}
              {sentence ? (
                <View>
                  <Text style={s.sentence} numberOfLines={3}>"{sentence.replace(/\n/g, ' ')}"</Text>
                  {sentenceTranslation ? (
                    <Text style={s.sentenceTranslation} numberOfLines={1}>{sentenceTranslation}</Text>
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

export const TodayWordCardSkeleton = () => (
  <View style={s.container}>
    <View style={s.skeletonFace}>
      <View style={s.header}>
        <View style={[s.skeletonLine, { width: 90, height: 10 }]} />
        <View style={[s.skeletonLine, { width: 80, height: 10 }]} />
      </View>
      <View style={[s.skeletonLine, { width: '55%', height: 30, marginTop: 10, marginBottom: 10 }]} />
      <View style={[s.skeletonLine, { width: '30%', height: 14 }]} />
    </View>
  </View>
);

const s = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    marginHorizontal: 16,
    marginTop: 8,
    height: CARD_HEIGHT,
    borderRadius: 16,
  },
  face: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#6B46C1',
    borderRadius: 16,
    backfaceVisibility: 'hidden',
    overflow: 'hidden',
    padding: FACE_PADDING,
  },
  back: {},
  skeletonFace: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#6B46C1',
    borderRadius: 16,
    padding: FACE_PADDING,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  movie: { fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 1, marginLeft: 8 },
  wordRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  wordPressable: { flexShrink: 1 },
  word: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  starBtn: { paddingLeft: 8, paddingVertical: 4 },
  star: { fontSize: 26, color: 'rgba(255,255,255,0.35)' },
  starSaved: { color: '#FACC15' },
  flipZone: { flex: 1 },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  translationWord: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  sentence: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontStyle: 'italic', lineHeight: 16, marginBottom: 2 },
  sentenceTranslation: { fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 15 },
  skeletonLine: { borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.15)' },
});

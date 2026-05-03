import React, { memo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors } from '../../theme/palette';
import { wordwiseApi, srsApi, API_BASE_URL, type TodaysWord } from '../../services/api';

interface Props {
  word: TodaysWord;
  targetLanguage: string;
  onReload: () => void;
  reloading: boolean;
  saved: boolean;
  onSave: () => void;
}

const _TodayWordCard = ({ word, targetLanguage, onReload, reloading, saved, onSave }: Props) => {
  const flipAnim = useRef(new Animated.Value(0)).current;
  const flipCount = useRef(0);

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

  const handleFlip = async () => {
    const next = flipCount.current + 1;
    flipCount.current = next;
    const isFlippingToBack = next % 2 === 1;

    // Fetch on first reveal only
    if (isFlippingToBack && !translation) {
      setTranslating(true);
      try {
        const [translationRes] = await Promise.all([
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
        ]);
        setTranslation(translationRes.translated);
      } catch {}
      setTranslating(false);
    }

    Animated.timing(flipAnim, {
      toValue: next,
      duration: 420,
      useNativeDriver: true,
    }).start();
  };

  const cardHeader = (
    <View style={s.header}>
      <View style={s.headerLeft}>
        <Text style={s.label}>Today's Word</Text>
        <TouchableOpacity
          onPress={onReload}
          disabled={reloading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[s.label, { opacity: reloading ? 0.35 : 1, marginLeft: 6 }]}>↻</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.movie} numberOfLines={1}>from {word.movie_title}</Text>
    </View>
  );

  return (
    <TouchableOpacity onPress={handleFlip} activeOpacity={1} style={s.container}>
      <View>
        {/* FRONT */}
        <Animated.View
          style={[s.face, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}
        >
          {cardHeader}
          <Text style={s.word}>{word.word}</Text>
          {word.cefr_level && (
            <View style={s.cefrBadge}>
              <Text style={s.cefrText}>{word.cefr_level}</Text>
            </View>
          )}
          <Text style={s.hint}>Tap to reveal translation</Text>
        </Animated.View>

        {/* BACK */}
        <Animated.View
          style={[s.face, s.back, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
        >
          {cardHeader}
          <Text style={s.word}>{word.word}</Text>

          {translating ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 14 }} />
          ) : (
            <>
              {translation && (
                <Text style={s.translation}>{translation.toLowerCase()}</Text>
              )}
              {sentence && (
                <Text style={s.sentence}>"{sentence}"</Text>
              )}
              {sentenceTranslation && (
                <Text style={s.sentenceTranslation}>{sentenceTranslation}</Text>
              )}
            </>
          )}

          <TouchableOpacity
            style={[s.saveBtn, saved && s.saveBtnSaved]}
            onPress={onSave}
            activeOpacity={0.75}
          >
            <Text style={[s.saveBtnText, saved && s.saveBtnTextSaved]}>
              {saved ? '★  Saved' : '☆  Save this word'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
};

export const TodayWordCard = memo(_TodayWordCard);

// Skeleton shown while the word is loading
export const TodayWordCardSkeleton = () => (
  <View style={s.container}>
    <View style={s.face}>
      <View style={[s.skeletonLine, { width: '40%', marginBottom: 16 }]} />
      <View style={[s.skeletonLine, { width: '60%', height: 28, marginBottom: 10 }]} />
      <View style={[s.skeletonLine, { width: '30%', height: 14, marginBottom: 20 }]} />
      <View style={[s.skeletonLine, { width: '100%', height: 38 }]} />
    </View>
  </View>
);

const s = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  face: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E8EC',
    padding: 20,
    backfaceVisibility: 'hidden',
  },
  back: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C5CBF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  movie: { fontSize: 11, color: '#9AA0AE', flexShrink: 1, marginLeft: 8 },
  word: { fontSize: 30, fontWeight: '800', color: '#1A1A2E', letterSpacing: -0.3 },
  cefrBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F0EBF8',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 6,
  },
  cefrText: { fontSize: 11, fontWeight: '700', color: '#7C5CBF' },
  hint: { fontSize: 12, color: '#9AA0AE', marginTop: 10 },
  translation: { fontSize: 15, color: '#7C5CBF', fontWeight: '500', marginTop: 4, marginBottom: 12 },
  sentence: { fontSize: 13, color: '#4A4A5A', fontStyle: 'italic', lineHeight: 19, marginBottom: 4 },
  sentenceTranslation: { fontSize: 12, color: '#9AA0AE', lineHeight: 17, marginBottom: 14 },
  saveBtn: {
    marginTop: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#7C5CBF',
    alignItems: 'center',
  },
  saveBtnSaved: { borderColor: '#4CAF9A', backgroundColor: '#F0FAF6' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#7C5CBF' },
  saveBtnTextSaved: { color: '#4CAF9A' },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#EBEBEB',
  },
});

import React, { memo, useEffect, useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, cefrColors } from '../../theme/palette';

// Serif gives the For You row a calmer, book-page feel — Georgia is
// preinstalled on iOS; Android falls back to its default serif (Noto Serif
// on most builds). Body text is upright; only the highlighted target word
// (in the sentence and on the word line) is italic.
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
import { wordwiseApi, type WordInfo } from '../../services/api';
import type { SentenceExample } from './WordRow';

const FADE_ANIM = {
  duration: 180,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};

interface Props {
  word: WordInfo;
  rowNumber: number;
  level: string;
  movieId?: number | null;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  isRead?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
  // Pre-fetched by the parent via the batch endpoint. `undefined` = still
  // loading (show skeleton); empty `sentence` string = confirmed miss.
  preloadedSentence?: { sentence: string; word_position: number; matched_form: string };
}

const _ForYouWordRow = ({
  word,
  rowNumber,
  level,
  movieId,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  isRead,
  accordionMode,
  lastOpenedKey,
  onExpand,
  preloadedSentence,
}: Props) => {
  const [translation, setTranslation] = useState<string | null>(null);
  const [translationVisible, setTranslationVisible] = useState(false);

  const levelColor = cefrColors[level] || colors.primary;
  const sentence: SentenceExample | null = preloadedSentence && preloadedSentence.sentence
    ? preloadedSentence
    : null;
  const sentenceLoaded = preloadedSentence !== undefined;

  // Accordion: another row opened — collapse this one's translation.
  useEffect(() => {
    if (accordionMode && translationVisible && lastOpenedKey && lastOpenedKey !== word.word) {
      LayoutAnimation.configureNext(FADE_ANIM);
      setTranslationVisible(false);
    }
  }, [accordionMode, lastOpenedKey, translationVisible, word.word]);

  const handlePress = () => {
    if (translationVisible) {
      LayoutAnimation.configureNext(FADE_ANIM);
      setTranslationVisible(false);
      return;
    }
    onExpand?.(word.word);
    if (isAuthenticated) {
      wordwiseApi.logInteraction(word.word, 'ROW_CLICK', movieId);
    }
    LayoutAnimation.configureNext(FADE_ANIM);
    setTranslationVisible(true);
    if (!translation) {
      wordwiseApi.translate(word.word, targetLang || 'ES', undefined, movieId)
        .then((result) => setTranslation(result.translated))
        .catch(() => setTranslation('Translation failed'));
    }
  };

  const rowBg = bookmarkHighlight ? '#FFF4D6' : isRead ? '#FAFAF8' : colors.paper;
  const numberStr = String(rowNumber).padStart(2, '0');

  let sentenceContent: React.ReactNode = null;
  if (sentenceLoaded && sentence) {
    const forms = new Set([word.word.toLowerCase()]);
    if (sentence.matched_form) forms.add(sentence.matched_form.toLowerCase());
    const escaped = [...forms].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
    const parts = sentence.sentence.split(regex);
    sentenceContent = (
      <Text style={styles.sentence}>
        {parts.map((part, i) =>
          forms.has(part.toLowerCase()) ? (
            <Text key={i} style={[styles.sentenceHi, { color: levelColor }]}>{part}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  } else if (!sentenceLoaded) {
    sentenceContent = (
      <View>
        <View style={[styles.skel, { width: '94%' }]} />
        <View style={[styles.skel, { width: '68%', marginTop: 6 }]} />
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: rowBg }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {bookmarkHighlight && <View style={styles.leftBar} />}
      <Text style={styles.rowNum}>{numberStr}</Text>
      <View style={styles.body}>
        {sentenceContent}
        <View style={styles.wordLine}>
          <Text style={[styles.wordLabel, { color: levelColor }, isRead && { opacity: 0.6 }]}>
            {word.word.toLowerCase()}
          </Text>
          {translationVisible && translation && (
            <>
              <Text style={styles.dot}> · </Text>
              <Text style={styles.translation}>{translation.toLowerCase()}</Text>
            </>
          )}
        </View>
      </View>
      {isAuthenticated && onSave && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); onSave(word.word); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.starBtn}
        >
          <Text style={[styles.star, isSaved && styles.starActive]}>
            {isSaved ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

export const ForYouWordRow = memo(_ForYouWordRow);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  leftBar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 3,
    backgroundColor: colors.warning,
  },
  rowNum: {
    fontSize: 12,
    fontFamily: SERIF,
    color: '#B0B5C0',
    fontWeight: '500',
    marginRight: 12,
    marginTop: 3,
    letterSpacing: 0.5,
    minWidth: 20,
  },
  body: { flex: 1 },
  sentence: {
    fontSize: 14,
    fontFamily: SERIF,
    color: colors.text,
    lineHeight: 21,
  },
  sentenceHi: {
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  wordLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  wordLabel: {
    fontSize: 13,
    fontFamily: SERIF,
    fontStyle: 'italic',
    fontWeight: '700',
  },
  dot: {
    fontSize: 13,
    fontFamily: SERIF,
    color: colors.textSecondary,
  },
  translation: {
    fontSize: 13,
    fontFamily: SERIF,
    color: colors.textSecondary,
  },
  starBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  star: {
    fontSize: 22,
    color: colors.border,
  },
  starActive: {
    color: colors.warning,
  },
  skel: {
    height: 14,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
});

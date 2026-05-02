import React, { memo, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../../theme/palette';
import { wordwiseApi, API_BASE_URL, type IdiomInfo } from '../../services/api';
import { rowStyles as styles } from './rowStyles';
import type { SentenceExample } from './WordRow';

interface Props {
  idiom: IdiomInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
}

// Mirrors WordRow: fetches translation + sentence examples on click and supports bookmarking.
const _IdiomRow = ({
  idiom,
  rowNumber,
  groupColor,
  movieId,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  accordionMode,
  lastOpenedKey,
  onExpand,
}: Props) => {
  const [expanded, setExpanded] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);

  const phrase = idiom.phrase;

  useEffect(() => {
    if (accordionMode && expanded && lastOpenedKey && lastOpenedKey !== phrase) {
      setExpanded(false);
    }
  }, [accordionMode, lastOpenedKey, expanded, phrase]);

  const handlePress = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    onExpand?.(phrase);

    if (isAuthenticated) {
      wordwiseApi.logInteraction(phrase, 'ROW_CLICK', movieId);
    }

    if (translation) {
      setExpanded(true);
      return;
    }

    setTranslating(true);
    try {
      const promises: Promise<void>[] = [];

      promises.push(
        wordwiseApi.translate(phrase, targetLang || 'ES', undefined, movieId)
          .then((result) => setTranslation(result.translated))
          .catch(() => setTranslation('Translation failed'))
      );

      if (movieId) {
        const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
        promises.push(
          fetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(phrase)}?max_examples=1${langParam}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.sentences && Array.isArray(data.sentences)) {
                setSentenceExamples(data.sentences);
              }
            })
            .catch(() => {})
        );
      }

      await Promise.all(promises);
      setExpanded(true);
    } finally {
      setTranslating(false);
    }
  };

  const isUntranslatable = translation && translation.toLowerCase() === phrase.toLowerCase();

  const renderHighlightedSentence = (sentence: string, target: string, matchedForm?: string) => {
    const words = new Set([target.toLowerCase()]);
    if (matchedForm) words.add(matchedForm.toLowerCase());
    const escaped = [...words].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
    const parts = sentence.split(regex);
    return (
      <Text style={styles.exampleSentence}>
        {parts.map((part, i) =>
          words.has(part.toLowerCase()) ? (
            <Text key={i} style={styles.highlightedWord}>{part}</Text>
          ) : (
            <Text key={i}>{part}</Text>
          )
        )}
      </Text>
    );
  };

  return (
    <View style={styles.wordRowWrapper}>
      <TouchableOpacity
        style={[styles.wordRow, expanded && styles.wordRowExpanded, bookmarkHighlight && styles.wordRowBookmarked]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.wordRowMain}>
          <Text style={styles.rowNumber}>{rowNumber}.</Text>
          <Text style={styles.wordText}>{phrase}</Text>
          {translating && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.inlineSpinner}
            />
          )}
          {isAuthenticated && onSave && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onSave(phrase); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.bookmarkButton}
            >
              <Text style={[styles.bookmarkIcon, isSaved && styles.bookmarkIconActive]}>
                {isSaved ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.dropdownPanel, { borderLeftColor: groupColor }]}>
          <View style={styles.translationBox}>
            <Text style={styles.translationDash}>—</Text>
            {translation ? (
              <Text
                style={[
                  styles.translationText,
                  isUntranslatable && styles.translationUntranslatable,
                ]}
              >
                {isUntranslatable ? '(same as source)' : translation.toLowerCase()}
              </Text>
            ) : (
              <Text style={styles.noTranslation}>No translation available</Text>
            )}
          </View>

          {sentenceExamples.length > 0 ? (
            sentenceExamples.map((example, idx) => (
              <View key={idx} style={styles.exampleCard}>
                {renderHighlightedSentence(example.sentence, phrase, example.matched_form)}
                {example.translation && (
                  <Text style={styles.exampleTranslation}>
                    {example.translation.toLowerCase()}
                  </Text>
                )}
              </View>
            ))
          ) : movieId ? (
            <Text style={styles.noExamples}>No sentence examples available</Text>
          ) : null}
        </View>
      )}
    </View>
  );
};
export const IdiomRow = memo(_IdiomRow);

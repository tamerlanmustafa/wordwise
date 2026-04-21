import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, cefrColors } from '../../theme/palette';
import { wordwiseApi, premiumApi, API_BASE_URL, type WordInfo, type CrossMovieSentence } from '../../services/api';
import { useIsPremium } from '../../stores/entitlementsStore';
import { ReportDialog } from '../ReportDialog';
import { rowStyles as styles } from './rowStyles';

export interface SentenceExample {
  sentence: string;
  word_position: number;
  matched_form?: string;
  translation?: string;
}

interface Props {
  word: WordInfo;
  index: number;
  rowNumber: number;
  groupColor: string;
  movieId?: number | null;
  movieTitle?: string;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (word: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
  displayLevel?: string;
  // When present, renders an admin-only "Hide word" control in the expanded
  // panel. Passed down only for admins by the parent screen.
  onHide?: (word: string) => void;
}

export const WordRow = ({
  word,
  rowNumber,
  groupColor,
  movieId,
  movieTitle,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  accordionMode,
  lastOpenedKey,
  onExpand,
  displayLevel,
  onHide,
}: Props) => {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (accordionMode && expanded && lastOpenedKey && lastOpenedKey !== word.word) {
      setExpanded(false);
    }
  }, [accordionMode, lastOpenedKey, expanded, word.word]);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [crossMovieSentences, setCrossMovieSentences] = useState<CrossMovieSentence[]>([]);
  const [playingAudio, setPlayingAudio] = useState(false);
  const isPremium = useIsPremium();

  const handlePress = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    onExpand?.(word.word);

    if (isAuthenticated) {
      wordwiseApi.logInteraction(word.word, 'ROW_CLICK', movieId);
    }

    if (translation) {
      setExpanded(true);
      return;
    }

    setTranslating(true);
    try {
      const promises: Promise<void>[] = [];

      promises.push(
        wordwiseApi.translate(word.word, targetLang || 'ES', undefined, movieId)
          .then((result) => setTranslation(result.translated))
          .catch(() => setTranslation('Translation failed'))
      );

      if (movieId) {
        const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
        promises.push(
          fetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(word.word)}?max_examples=1${langParam}`)
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

      if (isPremium) {
        premiumApi.crossMovieSentences(word.word).then(setCrossMovieSentences).catch(() => {});
      }
    } finally {
      setTranslating(false);
    }
  };

  const handlePronounce = async () => {
    if (playingAudio) return;
    setPlayingAudio(true);
    try {
      const { Audio } = require('expo-av');
      const { sound } = await Audio.Sound.createAsync(
        { uri: premiumApi.pronounceUrl(word.word) },
        { shouldPlay: true }
      );
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
          setPlayingAudio(false);
        }
      });
    } catch {
      setPlayingAudio(false);
    }
  };

  const isUntranslatable = translation && translation.toLowerCase() === word.word.toLowerCase();

  const renderHighlightedSentence = (sentence: string, targetWord: string, matchedForm?: string) => {
    const words = new Set([targetWord.toLowerCase()]);
    if (matchedForm) words.add(matchedForm.toLowerCase());
    const escaped = [...words].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
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
          <Text style={styles.wordText}>{word.word}</Text>
          {displayLevel && (
            <View style={[styles.inlineLevelBadge, { backgroundColor: cefrColors[displayLevel] || colors.primary }]}>
              <Text style={styles.inlineLevelBadgeText}>{displayLevel}</Text>
            </View>
          )}
          {isPremium && expanded && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); handlePronounce(); }}
              hitSlop={8}
              style={styles.pronounceBtn}
            >
              <Text style={[styles.pronounceIcon, playingAudio && styles.pronounceIconActive]}>
                {playingAudio ? '...' : '🔊'}
              </Text>
            </TouchableOpacity>
          )}
          {translating && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.inlineSpinner}
            />
          )}
          {isAuthenticated && onSave && (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation(); onSave(word.word); }}
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

      <ReportDialog
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        word={word.word}
        movieId={movieId ?? undefined}
        movieTitle={movieTitle}
      />

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
                {renderHighlightedSentence(example.sentence, word.word, example.matched_form)}
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

          {isPremium && crossMovieSentences.length > 0 && (
            <View style={styles.crossMovieSection}>
              <Text style={styles.crossMovieLabel}>Also appears in:</Text>
              {crossMovieSentences.slice(0, 3).map((s, i) => (
                <View key={i} style={styles.crossMovieItem}>
                  <Text style={styles.crossMovieMovie}>{s.movie_title}</Text>
                  <Text style={styles.crossMovieSentence}>"{s.sentence}"</Text>
                </View>
              ))}
            </View>
          )}
          {isAuthenticated && (
            <TouchableOpacity
              onPress={() => setReportOpen(true)}
              style={styles.reportInlineBtn}
            >
              <Text style={styles.reportInlineBtnText}>⚐ Report an issue</Text>
            </TouchableOpacity>
          )}
          {onHide && (
            <TouchableOpacity
              onPress={() => onHide(word.word)}
              style={styles.reportInlineBtn}
            >
              <Text style={[styles.reportInlineBtnText, { color: '#D66A6A' }]}>
                🚫 Hide word (admin)
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};


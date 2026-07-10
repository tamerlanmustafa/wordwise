import React, { memo, useEffect, useState } from 'react';
import {
  LayoutAnimation,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, cefrColors } from '../../theme/palette';
import { useThemeColors } from '../../theme/tokens';
import { wordwiseApi, premiumApi, authFetch, API_BASE_URL, type WordInfo, type CrossMovieSentence } from '../../services/api';
import { useIsPremium } from '../../stores/entitlementsStore';
import { ReportDialog } from '../ReportDialog';
import { rowStyles as styles } from './rowStyles';

export interface SentenceExample {
  sentence: string;
  word_position: number;
  matched_form?: string;
  translation?: string;
}

const EXPAND_ANIM = {
  duration: 220,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};
const REVEAL_ANIM = {
  duration: 180,
  create: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
  update: { type: 'easeInEaseOut' as const },
  delete: { type: 'easeInEaseOut' as const, property: 'opacity' as const },
};

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
  freqFill?: number;   // 0..1 rarity fill, computed by parent from visible set
  isRead?: boolean;    // word has been translated/tapped before
  // When present, renders an admin-only "Hide word" control in the expanded
  // panel. Passed down only for admins by the parent screen.
  onHide?: (word: string) => void;
}

// React.memo prevents re-renders when the parent updates but this row's
// props haven't changed. Key wins:
//   • Expanding one row changes `lastOpenedKey` in the parent — without memo
//     every sibling row re-renders. With memo only the newly-opened and
//     previously-open rows re-render.
//   • Saving a word changes the parent's `savedWords` Set — without memo
//     every row re-renders. With memo only the row whose `isSaved` prop
//     actually changed re-renders.
const _WordRow = ({
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
  freqFill,
  isRead,
  onHide,
}: Props) => {
  const tc = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);

  useEffect(() => {
    if (accordionMode && expanded && lastOpenedKey && lastOpenedKey !== word.word) {
      LayoutAnimation.configureNext(EXPAND_ANIM);
      setExpanded(false);
    }
  }, [accordionMode, lastOpenedKey, expanded, word.word]);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [crossMovieSentences, setCrossMovieSentences] = useState<CrossMovieSentence[]>([]);
  const [playingAudio, setPlayingAudio] = useState(false);
  const isPremium = useIsPremium();

  const handlePress = () => {
    if (expanded) {
      LayoutAnimation.configureNext(EXPAND_ANIM);
      setExpanded(false);
      return;
    }

    onExpand?.(word.word);
    if (isAuthenticated) {
      wordwiseApi.logInteraction(word.word, 'ROW_CLICK', movieId);
    }

    // Expand instantly with skeleton; content reveals together once both
    // fetches finish (translation, in-movie sentences). Report/Hide buttons
    // are gated on the same flag so they appear with the rest.
    LayoutAnimation.configureNext(EXPAND_ANIM);
    setExpanded(true);

    if (contentLoaded) return;

    const promises: Promise<void>[] = [];
    promises.push(
      wordwiseApi.translate(word.word, targetLang || 'ES', undefined, movieId)
        .then((result) => setTranslation(result.translated))
        .catch(() => setTranslation('Translation failed'))
    );
    if (movieId) {
      const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
      promises.push(
        authFetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(word.word)}?max_examples=1${langParam}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.sentences && Array.isArray(data.sentences)) {
              setSentenceExamples(data.sentences);
            }
          })
          .catch(() => {})
      );
    }
    Promise.all(promises).then(() => {
      LayoutAnimation.configureNext(REVEAL_ANIM);
      setContentLoaded(true);
    });

    // Cross-movie sentences load independently — they're a bonus block, not
    // gated with the primary content reveal.
    if (isPremium) {
      premiumApi.crossMovieSentences(word.word).then(setCrossMovieSentences).catch(() => {});
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

  // Treatments C + F: level wash → read tint → bookmark highlight (priority order)
  // Theme-aware: gold tint for bookmark, flat background tint when read,
  // translucent CEFR wash otherwise — all legible in light and dark mode.
  const rowBg = bookmarkHighlight ? `${tc.gold}2E` : isRead ? tc.chipBg : `${groupColor}10`;
  // 85% alpha (0xD9) normally, 45% (0x73) when read
  const fillAlpha = isRead ? '73' : 'D9';
  const freqLabel = freqFill == null ? null : freqFill > 0.66 ? 'RARE' : freqFill > 0.33 ? 'UNCOMMON' : 'COMMON';

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
        style={[styles.wordRow, { borderColor: tc.divider }, expanded && styles.wordRowExpanded, bookmarkHighlight && styles.wordRowBookmarked, { backgroundColor: rowBg }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        {/* Treatment F3: bookmark accent bar on left edge */}
        {bookmarkHighlight && (
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.warning, borderTopLeftRadius: 8, borderBottomLeftRadius: expanded ? 0 : 8 }} />
        )}
        <View style={styles.wordRowMain}>
          <Text style={[styles.rowNumber, { color: tc.textSecondary }, isRead && { opacity: 0.5 }]}>{rowNumber}.</Text>
          <Text style={[styles.wordText, { color: isRead ? tc.textSecondary : tc.text }]}>{word.word}</Text>
          {displayLevel && (
            <View style={[styles.inlineLevelBadge, { backgroundColor: cefrColors[displayLevel] || colors.primary }]}>
              <Text style={styles.inlineLevelBadgeText}>{displayLevel}</Text>
            </View>
          )}
          {/* Treatment A: rarity label between word and bookmark */}
          {freqLabel != null && (
            <Text style={{ fontSize: 10, fontWeight: '600', color: colors.textSecondary, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.3, marginRight: 4 }}>
              {freqLabel}
            </Text>
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
        {/* Treatment A: frequency density bar */}
        {freqFill != null && (
          <View style={{ marginLeft: 48, marginRight: 60, marginTop: 4 }}>
            <View style={{ height: 2, backgroundColor: `${groupColor}21`, borderRadius: 1 }}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${freqFill * 100}%`, backgroundColor: `${groupColor}${fillAlpha}`, borderRadius: 1 }} />
            </View>
          </View>
        )}
      </TouchableOpacity>

      <ReportDialog
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        word={word.word}
        movieId={movieId ?? undefined}
        movieTitle={movieTitle}
      />

      {expanded && (
        <View style={styles.dropdownPanel}>
          {contentLoaded ? (
            <>
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
            </>
          ) : (
            <View style={styles.expandSkeletonGroup}>
              <View style={[styles.expandSkeletonBar, styles.expandSkeletonBarShort]} />
              <View style={[styles.expandSkeletonBar, styles.expandSkeletonBarLong]} />
              <View style={[styles.expandSkeletonBar, styles.expandSkeletonBarMid]} />
            </View>
          )}

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
        </View>
      )}
    </View>
  );
};


export const WordRow = memo(_WordRow);

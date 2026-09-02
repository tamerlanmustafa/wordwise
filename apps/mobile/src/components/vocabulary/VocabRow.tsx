import React, { useEffect, useMemo, useState } from 'react';
import { LayoutAnimation, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme } from '../../theme/tokens';
import {
  wordwiseApi,
  premiumApi,
  authFetch,
  API_BASE_URL,
  type CrossMovieSentence,
} from '../../services/api';
import { useIsPremium } from '../../stores/entitlementsStore';
import { showToast } from '../../stores/toastStore';
import { pronounce } from '../../utils/pronunciation';
import { ReportDialog } from '../ReportDialog';
import { makeRowStyles, ROW_ICON_HIT_SLOP } from './rowStyles';
import { isSameAsSource } from './translationDisplay';

export interface SentenceExample {
  sentence: string;
  word_position: number;
  matched_form?: string;
  translation?: string;
  /** The target word's translation aligned to THIS sentence's translation
   *  (LLM-resolved server-side), so the card's word gloss matches the
   *  sentence. Absent when alignment is unavailable — fall back to a plain
   *  word translation. */
  word_translation?: string;
  /** One-line English learner gloss for the sense THIS sentence uses
   *  (`lemmas.definition`, generated from this very sentence). Per-lemma, so
   *  it is the same on every movie containing the word. Absent until the
   *  definition worker has reached the lemma — the card hides the line. */
  definition?: string | null;
  /** Learner part-of-speech label for the same lemma — `noun` / `verb` /
   *  `adj` / `adv`, already mapped from the raw UPOS tag server-side. Prefixes
   *  the definition on the card deck. Absent when the parser never tagged the
   *  lemma (~14% of the registry), which is independent of whether the
   *  definition is there. */
  pos?: string | null;
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

export interface VocabRowProps {
  /** The headword or phrase — shown, saved, translated. Also the accordion key. */
  term: string;
  rowNumber: number;
  /** Resolved CEFR colour for the highlight + expansion accents. */
  levelColor: string;
  variant?: 'word' | 'idiom';
  /** Small type badge shown after the term (idioms: "phrasal verb" / "idiom"). */
  badge?: string | null;
  movieId?: number | null;
  movieTitle?: string;
  targetLang?: string;
  isSaved?: boolean;
  onSave?: (term: string) => void;
  isAuthenticated?: boolean;
  bookmarkHighlight?: boolean;
  isRead?: boolean;
  accordionMode?: boolean;
  lastOpenedKey?: string | null;
  onExpand?: (key: string) => void;
  /** Admin-only global hide control in the expansion. */
  onHide?: (term: string) => void;
  /** Batch-prefetched preview (words only). `undefined` = still loading
   *  (skeleton); empty `sentence` = confirmed miss (parent hides the row). */
  preloadedSentence?: SentenceExample;
}

// Highlights every inflected form of the target inside the sentence with the
// level colour, serif-italic, no underline. Shared by the always-visible
// sentence, the idiom example, and the card deck (WordCardDeck).
export function renderHighlighted(
  sentence: string,
  target: string,
  matchedForm: string | undefined,
  color: string,
  baseStyle: any,
  hiStyle: any,
  numberOfLines?: number,
) {
  const forms = new Set([target.toLowerCase()]);
  if (matchedForm) forms.add(matchedForm.toLowerCase());
  const escaped = [...forms].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  const parts = sentence.split(regex);
  return (
    <Text style={baseStyle} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        forms.has(part.toLowerCase()) ? (
          <Text key={i} style={[hiStyle, { color }]}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

/**
 * The single word-first row used across the whole vocabulary list — For You
 * tab, level tabs, and idioms. Anatomy:
 *
 *   [##]  word  · translation-when-open            [☆]
 *         example sentence with the ~word~ highlighted
 *         ┃ sentence translation (only when open)
 *         ┃ ⚐ Report an issue
 */
export const VocabRow = ({
  term,
  rowNumber,
  levelColor,
  variant = 'word',
  badge,
  movieId,
  movieTitle,
  targetLang,
  isSaved,
  onSave,
  isAuthenticated,
  bookmarkHighlight,
  isRead,
  accordionMode,
  lastOpenedKey,
  onExpand,
  onHide,
  preloadedSentence,
}: VocabRowProps) => {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const dark = useColorScheme() === 'dark';
  const styles = useMemo(() => makeRowStyles(tc), [tc]);
  const isIdiom = variant === 'idiom';

  const [expanded, setExpanded] = useState(false);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sentenceExamples, setSentenceExamples] = useState<SentenceExample[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [crossMovieSentences, setCrossMovieSentences] = useState<CrossMovieSentence[]>([]);
  const [playingAudio, setPlayingAudio] = useState(false);
  const isPremium = useIsPremium();

  // Accordion: another row opened — collapse this one.
  useEffect(() => {
    if (accordionMode && expanded && lastOpenedKey && lastOpenedKey !== term) {
      LayoutAnimation.configureNext(EXPAND_ANIM);
      setExpanded(false);
    }
  }, [accordionMode, lastOpenedKey, expanded, term]);

  const handlePress = () => {
    if (expanded) {
      LayoutAnimation.configureNext(EXPAND_ANIM);
      setExpanded(false);
      return;
    }

    onExpand?.(term);
    if (isAuthenticated) {
      wordwiseApi.logInteraction(term, 'ROW_CLICK', movieId);
    }

    // Expand instantly with skeletons; the word translation + sentence
    // translation reveal together once both fetches finish. Gated on
    // contentLoaded so re-opening after an accordion collapse is free — no
    // network round-trip, the component stays mounted.
    LayoutAnimation.configureNext(EXPAND_ANIM);
    setExpanded(true);

    if (contentLoaded) return;

    const promises: Promise<void>[] = [];
    promises.push(
      wordwiseApi.translate(term, targetLang || 'ES', undefined, movieId)
        .then((result) => setTranslation(result.translated))
        .catch(() => setTranslation('Translation failed'))
    );
    if (movieId) {
      const langParam = targetLang ? `&target_lang=${encodeURIComponent(targetLang)}` : '';
      promises.push(
        authFetch(`${API_BASE_URL}/api/enrichment/movies/${movieId}/sentences/${encodeURIComponent(term)}?max_examples=1${langParam}`)
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

    // Cross-movie sentences load independently — a bonus block, not gated
    // with the primary reveal. Words only.
    if (isPremium && !isIdiom) {
      premiumApi.crossMovieSentences(term).then(setCrossMovieSentences).catch(() => {});
    }
  };

  const handlePronounce = async () => {
    if (playingAudio) return;
    setPlayingAudio(true);
    // Shared with the card deck (utils/pronunciation): the bearer token this
    // endpoint requires is decided in one place, not per component.
    const result = await pronounce(term);
    setPlayingAudio(false);
    if (result === 'failed') showToast({ tone: 'error', message: t('vocabulary:pronounceFailed') });
    else if (result === 'muted') showToast({ message: t('vocabulary:pronounceMuted') });
  };

  const isUntranslatable = isSameAsSource(term, translation);
  const enrichment = sentenceExamples[0] || null;

  // Word rows: the always-visible sentence is the batch preview, swapped for
  // the enrichment sentence once loaded (the enrichment endpoint is the source
  // of truth). Idioms have no preview — their example lives in the expansion.
  const collapsedSentence: SentenceExample | null =
    !isIdiom && preloadedSentence && preloadedSentence.sentence ? preloadedSentence : null;
  const previewLoading = !isIdiom && preloadedSentence === undefined;
  const visibleSentence: SentenceExample | null =
    !isIdiom && contentLoaded && enrichment ? enrichment : collapsedSentence;
  const sentenceTranslation = enrichment?.translation || null;

  // Row background priority: bookmark tint > expanded wash > transparent.
  // Read rows show only via text dimming — no fill.
  const rowBg = bookmarkHighlight
    ? (dark ? 'rgba(255,209,102,0.10)' : 'rgba(197,139,27,0.08)')
    : expanded
      ? `${levelColor}${dark ? '1F' : '12'}`
      : 'transparent';

  return (
    <View>
      <TouchableOpacity
        style={[styles.row, { backgroundColor: rowBg }]}
        onPress={handlePress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityHint={t('vocabulary:row.showsTranslation')}
      >
        {bookmarkHighlight && <View style={styles.leftBar} />}

        <Text style={[styles.rowNum, isRead && { opacity: 0.55 }]}>
          {String(rowNumber).padStart(2, '0')}
        </Text>

        <View style={styles.body}>
          {/* word line — word first; translation lands here on tap */}
          <View style={styles.wordLine}>
            <Text style={[styles.wordText, isRead && styles.wordTextRead]}>{term}</Text>
            {badge ? (
              <View style={[styles.idiomBadge, { backgroundColor: `${levelColor}22`, marginStart: 8 }]}>
                <Text style={[styles.idiomBadgeText, { color: levelColor }]}>{badge}</Text>
              </View>
            ) : null}
            {expanded && (
              contentLoaded ? (
                translation && !isUntranslatable ? (
                  <Text style={[styles.translationText, { marginStart: 8 }]}>
                    <Text style={styles.translationDot}>· </Text>
                    {translation.toLowerCase()}
                  </Text>
                ) : null
              ) : (
                <View style={[styles.translationSkeleton, { marginStart: 8 }]} />
              )
            )}
          </View>

          {/* example sentence — always visible for words (skeleton while the
              batch preview loads); highlighted target word in the level colour */}
          {!isIdiom && (
            visibleSentence ? (
              renderHighlighted(
                visibleSentence.sentence,
                term,
                visibleSentence.matched_form,
                levelColor,
                styles.sentence,
                styles.sentenceHi,
              )
            ) : previewLoading ? (
              <View style={styles.sentenceSkeletonWrap}>
                <View style={[styles.skelBar, { width: '94%' }]} />
                <View style={[styles.skelBar, { width: '68%', marginTop: 6 }]} />
              </View>
            ) : null
          )}

          {/* expansion — sentence translation (words) / example (idioms) + actions */}
          {expanded && (
            <View style={[styles.expansion, { borderStartColor: `${levelColor}66` }]}>
              {!contentLoaded ? (
                <View style={styles.expandSkeletonGroup}>
                  <View style={[styles.skelBar, { width: '88%', height: 11 }]} />
                  <View style={[styles.skelBar, { width: '56%', height: 11 }]} />
                </View>
              ) : (
                <>
                  {isIdiom && enrichment ? (
                    renderHighlighted(
                      enrichment.sentence,
                      term,
                      enrichment.matched_form,
                      levelColor,
                      styles.idiomSentence,
                      styles.sentenceHi,
                    )
                  ) : null}

                  {sentenceTranslation ? (
                    <Text style={styles.sentenceTranslation}>{sentenceTranslation}</Text>
                  ) : isIdiom && movieId && !enrichment ? (
                    <Text style={styles.noExamples}>{t('vocabulary:row.noExamples')}</Text>
                  ) : null}

                  <View style={styles.actionsRow}>
                    {isAuthenticated && (
                      <Text
                        style={styles.actionText}
                        onPress={() => setReportOpen(true)}
                        accessibilityRole="button"
                      >
                        ⚐ Report an issue
                      </Text>
                    )}
                    {onHide && (
                      <Text
                        style={[styles.actionText, styles.actionHide]}
                        onPress={() => onHide(term)}
                        accessibilityRole="button"
                      >
                        🚫 Hide word
                      </Text>
                    )}
                    {isPremium && !isIdiom && (
                      // Touchable + slop, not a bare `Text onPress` — see
                      // ROW_ICON_HIT_SLOP. The row itself is a touchable, so
                      // an unpadded near miss collapsed the row instead of
                      // playing the word.
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          handlePronounce();
                        }}
                        hitSlop={ROW_ICON_HIT_SLOP}
                        accessibilityRole="button"
                        accessibilityLabel={t('vocabulary:row.pronounce')}
                      >
                        <Text
                          style={[styles.actionText, styles.pronounceIcon, playingAudio && styles.pronounceIconActive]}
                        >
                          {playingAudio ? '…' : '🔊'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {isPremium && !isIdiom && crossMovieSentences.length > 0 && (
                    <View style={styles.crossMovieSection}>
                      <Text style={styles.crossMovieLabel}>{t('vocabulary:row.alsoAppearsIn')}</Text>
                      {crossMovieSentences.slice(0, 3).map((s, i) => (
                        <View key={i} style={styles.crossMovieItem}>
                          <Text style={styles.crossMovieMovie}>{s.movie_title}</Text>
                          <Text style={styles.crossMovieSentence}>"{s.sentence}"</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          )}
        </View>

        {isAuthenticated && onSave && (
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); onSave(term); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.starBtn}
            accessibilityRole="button"
            accessibilityLabel={isSaved ? t('vocabulary:row.removeFromSaved') : t('vocabulary:row.saveWord')}
          >
            <Text style={[styles.star, isSaved && styles.starActive]}>{isSaved ? '★' : '☆'}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <ReportDialog
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        word={term}
        movieId={movieId ?? undefined}
        movieTitle={movieTitle}
      />
    </View>
  );
};

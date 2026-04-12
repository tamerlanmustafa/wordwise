import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { srsApi, wordwiseApi, SrsPaywallError, type SrsReviewCard } from '../services/api';

// Leitner review session UI.
//
// Flow:
//   1. POST /srs/session/start → get up to N due cards (or 402 → paywall)
//   2. Card shows word. Tap "Show answer" → reveal definition/sentence.
//   3. "Got it" / "Forgot" → POST /srs/review, advance to next card.
//   4. When the stack empties → summary screen.
//
// This component intentionally keeps definition/translation lookup on the
// client side of the SRS loop: the review endpoint only records outcomes.
// If we want richer card content later (examples, images, audio), extend
// /srs/session/start to include it rather than fanning out N extra calls.

const COLORS = {
  primary: '#7C5CBF',
  background: '#FAFAF8',
  paper: '#FFFFFF',
  text: '#2D3142',
  textSecondary: '#5C6378',
  textTertiary: '#9AA0AE',
  border: '#E8E8EC',
  success: '#4CAF9A',
  error: '#D66A6A',
};

export interface ReviewScreenProps {
  onBack: () => void;
  onPaywall: (previews_used: number, previews_limit: number) => void;
}

type Phase = 'loading' | 'prompt' | 'answer' | 'done' | 'empty' | 'error';

const cefrColor = (level: string) => {
  const map: Record<string, string> = { A1: '#4CAF50', A2: '#8BC34A', B1: '#FFC107', B2: '#FF9800', C1: '#F44336', C2: '#9C27B0' };
  return map[level] || COLORS.primary;
};

export function ReviewScreen({ onBack, onPaywall }: ReviewScreenProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [cards, setCards] = useState<SrsReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ got: 0, forgot: 0 });
  const [previewsRemaining, setPreviewsRemaining] = useState<number | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(1)).current;

  const loadSession = useCallback(async () => {
    setPhase('loading');
    setIndex(0);
    setStats({ got: 0, forgot: 0 });
    try {
      const session = await srsApi.startSession();
      setCards(session.cards);
      setIsPreview(session.is_preview);
      setPreviewsRemaining(session.previews_remaining);
      wordwiseApi.logInteraction('_srs', 'SRS_SESSION_START', undefined, {
        card_count: session.cards.length,
        is_preview: session.is_preview,
        previews_remaining: session.previews_remaining,
      });
      if (session.cards.length === 0) {
        setPhase('empty');
      } else {
        setPhase('prompt');
      }
    } catch (e: any) {
      if (e instanceof SrsPaywallError) {
        onPaywall(e.previews_used, e.previews_limit);
        return;
      }
      console.warn('[ReviewScreen] startSession failed:', e?.message);
      setErrorMessage(e?.message || 'Failed to start review session');
      setPhase('error');
    }
  }, [onPaywall]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const currentCard = cards[index];

  const advance = useCallback(
    (correct: boolean) => {
      if (!currentCard) return;
      // Fire-and-forget the review POST. If it fails the scheduler will
      // just show the card again on the next session — worst case a user
      // sees a word one extra time, not a silent data-loss bug.
      srsApi.review(currentCard.user_word_id, correct).catch((e) => {
        console.warn('[ReviewScreen] review record failed:', e?.message);
      });
      setStats((s) => ({
        got: s.got + (correct ? 1 : 0),
        forgot: s.forgot + (correct ? 0 : 1),
      }));

      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();

      if (index + 1 >= cards.length) {
        setPhase('done');
      } else {
        setIndex(index + 1);
        setPhase('prompt');
      }
    },
    [currentCard, index, cards.length, fade]
  );

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptyBody}>{errorMessage}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={loadSession}>
            <Text style={styles.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'empty') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Nothing due right now</Text>
          <Text style={styles.emptyBody}>
            All your saved words are scheduled for later. Come back tomorrow —
            or save more words from a new movie.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onBack}>
            <Text style={styles.primaryBtnText}>Back home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'done') {
    const total = stats.got + stats.forgot;
    const pct = total > 0 ? Math.round((stats.got / total) * 100) : 0;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Session complete</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.bigStat}>{pct}%</Text>
          <Text style={styles.emptyBody}>
            You remembered {stats.got} of {total} words.
          </Text>
          {isPreview && previewsRemaining !== null && (
            <Text style={styles.previewHint}>
              {previewsRemaining > 0
                ? `${previewsRemaining} free ${previewsRemaining === 1 ? 'session' : 'sessions'} left`
                : 'This was your last free session.'}
            </Text>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={onBack}>
            <Text style={styles.primaryBtnText}>Back home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'prompt' | 'answer'
  const showAnswer = phase === 'answer';
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={8}>
          <Text style={styles.backText}>← Exit</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {index + 1} / {cards.length}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <Animated.View style={[styles.cardArea, { opacity: fade }]}>
        <View style={styles.card}>
          <View style={styles.cardTopRow}>
            <Text style={styles.boxBadge}>Box {currentCard?.srs_box ?? 1}</Text>
            {currentCard?.cefr_level && (
              <Text style={[styles.cefrBadge, { backgroundColor: cefrColor(currentCard.cefr_level) }]}>
                {currentCard.cefr_level}
              </Text>
            )}
          </View>
          <Text style={styles.word}>{currentCard?.word}</Text>
          {currentCard?.movie_title && (
            <Text style={styles.movieHint}>from {currentCard.movie_title}</Text>
          )}
          {showAnswer ? (
            <View style={styles.answerContent}>
              {currentCard?.definition && (
                <Text style={styles.definition}>{currentCard.definition}</Text>
              )}
              {currentCard?.example_sentence && (
                <Text style={styles.exampleSentence}>"{currentCard.example_sentence}"</Text>
              )}
              {!currentCard?.definition && !currentCard?.example_sentence && (
                <Text style={styles.hint}>Do you remember what this means?</Text>
              )}
            </View>
          ) : (
            <Text style={styles.hint}>
              Try to recall the meaning, then tap below.
            </Text>
          )}
        </View>
      </Animated.View>

      <View style={styles.footer}>
        {!showAnswer ? (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setPhase('answer')}
          >
            <Text style={styles.primaryBtnText}>Show answer</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.answerRow}>
            <TouchableOpacity
              style={[styles.answerBtn, styles.forgotBtn]}
              onPress={() => advance(false)}
            >
              <Text style={styles.answerBtnText}>Forgot</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.answerBtn, styles.gotItBtn]}
              onPress={() => advance(true)}
            >
              <Text style={styles.answerBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.paper,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backText: { fontSize: 16, color: COLORS.primary, fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  cardArea: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    backgroundColor: COLORS.paper,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  boxBadge: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cefrBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  word: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  movieHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  answerContent: {
    width: '100%',
    alignItems: 'center',
    gap: 12,
  },
  definition: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '500',
  },
  exampleSentence: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  footer: { padding: 24 },
  answerRow: { flexDirection: 'row', gap: 12 },
  answerBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  gotItBtn: { backgroundColor: COLORS.success },
  forgotBtn: { backgroundColor: COLORS.error },
  answerBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
  emptyBody: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  bigStat: { fontSize: 56, fontWeight: '700', color: COLORS.primary },
  previewHint: { fontSize: 13, color: COLORS.textTertiary, fontStyle: 'italic' },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import {
  quizApi,
  type QuizCard,
  type QuizCardResultInput,
  type QuizCompleteResponse,
  type QuizSelfRating,
  type QuizStartSessionResponse,
} from '../services/api';
import { track } from '../services/analytics';
import { feedback } from '../utils/feedback';
import { QuizHeader } from './quiz/QuizHeader';
import { SessionFinishing } from './quiz/SessionFinishing';
import { MCQCard } from './quiz/MCQCard';
import { alignEnd } from '../i18n/rtl';

// Minimum time the celebratory finish beat stays on screen, so the reward
// always lands even when the network resolves instantly. The submit + score
// calls run *behind* this (see SMOOTHNESS_AND_DESIGN_PLAYBOOK §3).
const MIN_CELEBRATION_MS = 900;

export interface QuizLessonScreenProps {
  session: QuizStartSessionResponse;
  level: string;
  /** v0.7 §7 — movie title for the shared QuizHeader. Optional so
   *  legacy callers don't have to change all at once; falls back to
   *  the level label when absent. */
  onExit: () => void;
  onComplete: (
    result: QuizCompleteResponse,
    level: string,
    cardResults: QuizCardResultInput[],
  ) => void;
}

export function QuizLessonScreen({
  session,
  level,
  onExit,
  onComplete,
}: QuizLessonScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<QuizCardResultInput[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const cards = session.cards;
  const total = cards.length;
  const card: QuizCard | undefined = cards[idx];

  // §10 — instrument the lesson journey. `level`/`total` are fixed for a
  // session, so this fires once on mount.
  useEffect(() => {
    track('lesson_start', { level, cards: total });
  }, [level, total]);

  // Load the answer chimes while the user is reading the first card, so the
  // first answer doesn't pay ~100ms of decode on the frame that should feel
  // instant. Released with the session — nothing outside a deck uses them.
  useEffect(() => {
    void feedback.preload();
    return () => {
      void feedback.release();
    };
  }, []);
  // Primary accent retained for the self-rate / empty paths that still
  // use the old styles. The new card components key off `tc.gold` /
  // `tc.success` etc. directly.
  const accent = tc.primaryOnSurface;

  if (!card) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.centered}>
          <Text style={s.emptyText}>{t('quiz:lesson.empty')}</Text>
          <TouchableOpacity onPress={onExit} style={s.exitBtn}>
            <Text style={s.exitBtnText}>{t('action.back')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const recordAndAdvance = (entry: QuizCardResultInput) => {
    const next = [...results, entry];
    setResults(next);
    startedAtRef.current = Date.now();

    if (idx + 1 >= total) {
      void finishSession(next);
    } else {
      setIdx(idx + 1);
    }
  };

  const finishSession = async (final: QuizCardResultInput[]) => {
    setFinishing(true);
    setError(null);
    // Run the network work and a minimum celebration delay in parallel so the
    // reward beat (SessionFinishing) always plays for at least MIN_CELEBRATION_MS
    // — the animation masks the latency instead of a dead spinner.
    const minBeat = new Promise<void>((resolve) => setTimeout(resolve, MIN_CELEBRATION_MS));
    try {
      const work = (async () => {
        await quizApi.submitCards(session.session_id, final);
        return quizApi.completeSession(session.session_id);
      })();
      const [result] = await Promise.all([work, minBeat]);
      track('lesson_end', {
        level,
        correct: result.correct_count,
        total: result.total_scored,
        xp: result.xp_earned,
      });
      onComplete(result, level, final);
    } catch (e) {
      console.warn('[QuizLesson] finish failed:', e);
      setError(t('quiz:lesson.saveFailed'));
      setFinishing(false);
    }
  };

  // The MCQCard fires `onAnswer(correct)` exactly once per card; we
  // record the result under the 'mcq' card_type for the server.
  const handleMcqAnswer = (correct: boolean) => {
    const answerMs = Date.now() - startedAtRef.current;
    recordAndAdvance({
      word: card.word,
      card_type: 'mcq',
      is_correct: correct,
      self_rating: null,
      answer_ms: answerMs,
    });
  };

  const handleSelfRate = (rating: QuizSelfRating) => {
    const answerMs = Date.now() - startedAtRef.current;
    recordAndAdvance({
      word: card.word,
      card_type: 'self_rate',
      is_correct: null,
      self_rating: rating,
      answer_ms: answerMs,
    });
  };

  if (finishing) {
    return <SessionFinishing />;
  }

  if (error) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.centered}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => finishSession(results)}
            style={[s.exitBtn, { backgroundColor: accent }]}
          >
            <Text style={s.exitBtnText}>{t('action.retry')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onExit} style={s.exitGhost}>
            <Text style={s.exitGhostText}>{t('quiz:lesson.exit')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <QuizHeader
        index={idx + 1}
        total={total}
        onBack={onExit}
      />

      <View style={{ flex: 1 }}>
        {card.card_type === 'mcq' && card.choices ? (
          <MCQCard
            // Reset internal state when the card index advances.
            key={`tmcq-${idx}-${card.word}`}
            word={card.word}
            pos={card.pos}
            example={card.example_sentence}
            choices={card.choices}
            // Per-card, falling back to the lesson's own level: this deck is
            // built for one band, but the card knows its own.
            level={card.cefr_level ?? level}
            onAnswer={handleMcqAnswer}
          />
        ) : (
          <View style={s.body}>
            <Text style={s.prompt}>{t('quiz:lesson.prompt')}</Text>
            <View style={[s.wordCard, { borderColor: accent }]}>
              <Text style={s.wordText}>{card.word}</Text>
            </View>

            <View style={s.selfRateCol}>
              <TouchableOpacity
                onPress={() => handleSelfRate('know')}
                style={[s.rateBtn, { backgroundColor: tc.success }]}
                activeOpacity={0.8}
              >
                <Text style={s.rateBtnText}>{t('quiz:lesson.know')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('kinda')}
                style={[s.rateBtn, { backgroundColor: tc.warning }]}
                activeOpacity={0.8}
              >
                <Text style={[s.rateBtnText, { color: tc.goldDeep }]}>{t('quiz:lesson.kindOf')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('dont')}
                style={[s.rateBtn, { backgroundColor: tc.error }]}
                activeOpacity={0.8}
              >
                <Text style={s.rateBtnText}>{t('quiz:lesson.dontKnow')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors, _scheme: 'light' | 'dark') => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    backgroundColor: tc.paper,
    borderBottomWidth: 1, borderBottomColor: tc.border,
  },
  closeX: { fontSize: 20, color: tc.textSecondary, fontWeight: '600' },
  progressTrack: {
    flex: 1, height: 10, borderRadius: 5,
    backgroundColor: tc.border, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 5 },
  progressLabel: {
    fontSize: 12, fontWeight: '700', color: tc.textSecondary,
    width: 40, textAlign: alignEnd,
  },
  body: { flex: 1, padding: 20 },
  prompt: {
    fontSize: 13, color: tc.textSecondary, textAlign: 'center',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  wordCard: {
    marginTop: 16, marginBottom: 24,
    paddingVertical: 36, paddingHorizontal: 20,
    borderRadius: 16, borderWidth: 2,
    backgroundColor: tc.paper,
    alignItems: 'center',
  },
  wordText: { fontSize: 32, fontWeight: '800', color: tc.text },
  selfRateCol: { gap: 12, marginTop: 8 },
  rateBtn: {
    paddingVertical: 18, borderRadius: 14,
    alignItems: 'center',
  },
  rateBtnText: { fontSize: 16, fontWeight: '700', color: tc.textInverse },
  footer: { marginTop: 'auto', paddingVertical: 16, alignItems: 'center' },
  primaryBtn: {
    paddingVertical: 14, paddingHorizontal: 40,
    borderRadius: 14, width: '100%', alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14, color: tc.textSecondary, marginBottom: 16 },
  exitBtn: {
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10,
    backgroundColor: tc.primary,
  },
  exitBtnText: { color: tc.textInverse, fontWeight: '700' },
  exitGhost: { paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  exitGhostText: { color: tc.textSecondary, fontWeight: '600' },
  errorText: { color: tc.error, marginBottom: 12, textAlign: 'center' },
});

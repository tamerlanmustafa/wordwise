import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { cefrColors } from '../theme/palette';
import { useThemeColors, useColorScheme, type ThemeColors } from '../theme/tokens';
import {
  quizApi,
  type QuizCard,
  type QuizCardResultInput,
  type QuizCompleteResponse,
  type QuizSelfRating,
  type QuizStartSessionResponse,
} from '../services/api';

export interface QuizLessonScreenProps {
  session: QuizStartSessionResponse;
  level: string;
  onExit: () => void;
  onComplete: (
    result: QuizCompleteResponse,
    level: string,
    cardResults: QuizCardResultInput[],
  ) => void;
}

const COMBINING_DIACRITICS = /[̀-ͯ]/g;
const PUNCT = /[.,!?¿¡;:'"()[\]{}]/g;

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .replace(PUNCT, '')
    .replace(/\s+/g, ' ');
}

function splitAlternates(s: string): string[] {
  return s.split(/[\/,]/).map((t) => t.trim()).filter(Boolean);
}

function isTypedCorrect(userInput: string, expected: string): boolean {
  const a = normalize(userInput);
  if (!a) return false;
  const alts = splitAlternates(expected).map(normalize);
  if (alts.includes(a)) return true;
  return a === normalize(expected);
}

export function QuizLessonScreen({
  session,
  level,
  onExit,
  onComplete,
}: QuizLessonScreenProps) {
  const tc = useThemeColors();
  const scheme = useColorScheme();
  const s = useMemo(() => makeStyles(tc, scheme), [tc, scheme]);

  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<QuizCardResultInput[]>([]);
  const [typed, setTyped] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const cards = session.cards;
  const total = cards.length;
  const card: QuizCard | undefined = cards[idx];
  // Primary accent for input + check button. Quiz Card uses
  // `primaryOnSurface` so #7C5CBF pops on dark mode via primaryLight.
  const accent = tc.primaryOnSurface;
  const levelColor = cefrColors[level] || accent;
  const progress = total > 0 ? (idx / total) : 0;

  if (!card) {
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.centered}>
          <Text style={s.emptyText}>No cards in this session.</Text>
          <TouchableOpacity onPress={onExit} style={s.exitBtn}>
            <Text style={s.exitBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const recordAndAdvance = (entry: QuizCardResultInput) => {
    const next = [...results, entry];
    setResults(next);
    setTyped('');
    setRevealed(false);
    setLastCorrect(null);
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
    try {
      await quizApi.submitCards(session.session_id, final);
      const result = await quizApi.completeSession(session.session_id);
      onComplete(result, level, final);
    } catch (e) {
      console.warn('[QuizLesson] finish failed:', e);
      setError('Could not save results. Tap retry.');
      setFinishing(false);
    }
  };

  const handleTypeCheck = () => {
    if (revealed) return;
    const expected = card.translation || '';
    const correct = expected ? isTypedCorrect(typed, expected) : false;
    setLastCorrect(correct);
    setRevealed(true);
  };

  const handleTypeContinue = () => {
    const answerMs = Date.now() - startedAtRef.current;
    recordAndAdvance({
      word: card.word,
      card_type: 'type',
      is_correct: !!lastCorrect,
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
    return (
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={s.finishingText}>Scoring your session…</Text>
        </View>
      </SafeAreaView>
    );
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
            <Text style={s.exitBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onExit} style={s.exitGhost}>
            <Text style={s.exitGhostText}>Exit</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Check / Continue button colour: gold on dark, purple on light.
  const ctaBg = scheme === 'dark' ? tc.gold : tc.primary;
  const ctaFg = scheme === 'dark' ? tc.goldDeep : tc.textInverse;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={onExit} hitSlop={8} style={{ width: 28 }}>
          <Text style={s.closeX}>✕</Text>
        </TouchableOpacity>
        <View style={s.progressTrack}>
          <View
            style={[
              s.progressFill,
              { width: `${progress * 100}%`, backgroundColor: levelColor },
            ]}
          />
        </View>
        <Text style={s.progressLabel}>{idx + 1}/{total}</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {card.card_type === 'type' ? (
          <View style={s.body}>
            <Text style={s.prompt}>Translate this word</Text>
            <View style={[s.wordCard, { borderColor: accent }]}>
              <Text style={s.wordText}>{card.word}</Text>
            </View>

            <TextInput
              style={[
                s.input,
                { borderColor: accent },
                revealed && lastCorrect && s.inputCorrect,
                revealed && !lastCorrect && s.inputWrong,
              ]}
              placeholder="Type the translation…"
              placeholderTextColor={tc.textSecondary}
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!revealed}
              onSubmitEditing={!revealed && typed.trim() ? handleTypeCheck : undefined}
              returnKeyType="done"
            />

            {revealed && (
              <View
                style={[
                  s.feedback,
                  lastCorrect ? s.feedbackCorrect : s.feedbackWrong,
                ]}
              >
                <Text style={[s.feedbackTitle, lastCorrect ? s.feedbackTitleOk : s.feedbackTitleWrong]}>
                  {lastCorrect ? 'Correct!' : 'Not quite'}
                </Text>
                <Text style={s.feedbackText}>
                  Answer: {card.translation || '—'}
                </Text>
              </View>
            )}

            <View style={s.footer}>
              {revealed ? (
                <TouchableOpacity
                  onPress={handleTypeContinue}
                  style={[s.primaryBtn, { backgroundColor: ctaBg }]}
                  activeOpacity={0.8}
                >
                  <Text style={[s.primaryBtnText, { color: ctaFg }]}>Continue →</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleTypeCheck}
                  disabled={!typed.trim()}
                  style={[
                    s.primaryBtn,
                    { backgroundColor: ctaBg, opacity: typed.trim() ? 1 : 0.4 },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={[s.primaryBtnText, { color: ctaFg }]}>Check Answer</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View style={s.body}>
            <Text style={s.prompt}>Do you know this word?</Text>
            <View style={[s.wordCard, { borderColor: accent }]}>
              <Text style={s.wordText}>{card.word}</Text>
            </View>

            <View style={s.selfRateCol}>
              <TouchableOpacity
                onPress={() => handleSelfRate('know')}
                style={[s.rateBtn, { backgroundColor: tc.success }]}
                activeOpacity={0.8}
              >
                <Text style={s.rateBtnText}>I know it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('kinda')}
                style={[s.rateBtn, { backgroundColor: tc.warning }]}
                activeOpacity={0.8}
              >
                <Text style={[s.rateBtnText, { color: tc.goldDeep }]}>Kind of</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('dont')}
                style={[s.rateBtn, { backgroundColor: tc.error }]}
                activeOpacity={0.8}
              >
                <Text style={s.rateBtnText}>Don't know</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
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
    width: 40, textAlign: 'right',
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
  translationSmall: { fontSize: 14, color: tc.textSecondary, marginTop: 6 },
  input: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 18,
    color: tc.text,
    backgroundColor: tc.paper,
  },
  inputCorrect: {
    borderColor: tc.success,
    backgroundColor: tc.paper,
  },
  inputWrong: {
    borderColor: tc.error,
    backgroundColor: tc.errorTint,
  },
  feedback: {
    marginTop: 16,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12,
  },
  feedbackCorrect: { backgroundColor: tc.paper, borderWidth: 1, borderColor: tc.success },
  feedbackWrong: { backgroundColor: tc.errorTint },
  feedbackTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  feedbackTitleOk: { color: tc.success },
  feedbackTitleWrong: { color: tc.error },
  feedbackText: { fontSize: 14, color: tc.text },
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
  finishingText: { fontSize: 14, color: tc.textSecondary, marginTop: 16 },
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

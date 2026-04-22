import { useRef, useState } from 'react';
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
import { colors, cefrColors } from '../theme/palette';
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
  onComplete: (result: QuizCompleteResponse, level: string) => void;
}

// Normalize strings before comparing a typed answer to the expected
// translation. Strips accents, punctuation, surrounding whitespace, and
// collapses multiple spaces. Case-insensitive. Lenient enough that a
// learner typing "hola!" matches "Hola".
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

// Accept alternate translations separated by "/" or "," ("hola/salut" →
// either counts). The backend sometimes returns comma-joined variants.
function splitAlternates(s: string): string[] {
  return s.split(/[\/,]/).map((t) => t.trim()).filter(Boolean);
}

function isTypedCorrect(userInput: string, expected: string): boolean {
  const a = normalize(userInput);
  if (!a) return false;
  const alts = splitAlternates(expected).map(normalize);
  if (alts.includes(a)) return true;
  // Also accept the full expected string as one atom (in case split removed
  // legitimate commas inside a phrase).
  return a === normalize(expected);
}

// Card-by-card playthrough. Tracks answers in local state, batches them at
// the end via submitCards → completeSession. We batch rather than submit
// per-card so a flaky network doesn't interrupt the flow.
export function QuizLessonScreen({
  session,
  level,
  onExit,
  onComplete,
}: QuizLessonScreenProps) {
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
  const color = cefrColors[level] || colors.primary;
  const progress = total > 0 ? (idx / total) : 0;

  if (!card) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No cards in this session.</Text>
          <TouchableOpacity onPress={onExit} style={styles.exitBtn}>
            <Text style={styles.exitBtnText}>Back</Text>
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
      onComplete(result, level);
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={color} />
          <Text style={styles.finishingText}>Scoring your session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            onPress={() => finishSession(results)}
            style={[styles.exitBtn, { backgroundColor: color }]}
          >
            <Text style={styles.exitBtnText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onExit} style={styles.exitGhost}>
            <Text style={styles.exitGhostText}>Exit</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onExit} hitSlop={8} style={{ width: 28 }}>
          <Text style={styles.closeX}>✕</Text>
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progress * 100}%`, backgroundColor: color },
            ]}
          />
        </View>
        <Text style={styles.progressLabel}>{idx + 1}/{total}</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {card.card_type === 'type' ? (
          <View style={styles.body}>
            <Text style={styles.prompt}>Translate this word</Text>
            <View style={[styles.wordCard, { borderColor: color }]}>
              <Text style={styles.wordText}>{card.word}</Text>
            </View>

            <TextInput
              style={[
                styles.input,
                revealed && lastCorrect && styles.inputCorrect,
                revealed && !lastCorrect && styles.inputWrong,
              ]}
              placeholder="Type the translation…"
              placeholderTextColor={colors.textSecondary}
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
                  styles.feedback,
                  lastCorrect ? styles.feedbackCorrect : styles.feedbackWrong,
                ]}
              >
                <Text style={[styles.feedbackTitle, !lastCorrect && { color: '#B71C1C' }]}>
                  {lastCorrect ? 'Correct!' : 'Not quite'}
                </Text>
                <Text style={styles.feedbackText}>
                  Answer: {card.translation || '—'}
                </Text>
              </View>
            )}

            <View style={styles.footer}>
              {revealed ? (
                <TouchableOpacity
                  onPress={handleTypeContinue}
                  style={[styles.primaryBtn, { backgroundColor: color }]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryBtnText}>Continue →</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleTypeCheck}
                  disabled={!typed.trim()}
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: color, opacity: typed.trim() ? 1 : 0.4 },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryBtnText}>Check</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.prompt}>Do you know this word?</Text>
            <View style={[styles.wordCard, { borderColor: color }]}>
              <Text style={styles.wordText}>{card.word}</Text>
              {card.translation && (
                <Text style={styles.translationSmall}>{card.translation}</Text>
              )}
            </View>

            <View style={styles.selfRateCol}>
              <TouchableOpacity
                onPress={() => handleSelfRate('know')}
                style={[styles.rateBtn, { backgroundColor: '#4CAF50' }]}
                activeOpacity={0.8}
              >
                <Text style={styles.rateBtnText}>I know it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('kinda')}
                style={[styles.rateBtn, { backgroundColor: '#FFC107' }]}
                activeOpacity={0.8}
              >
                <Text style={[styles.rateBtnText, { color: '#3E2A00' }]}>Kind of</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSelfRate('dont')}
                style={[styles.rateBtn, { backgroundColor: '#D66A6A' }]}
                activeOpacity={0.8}
              >
                <Text style={styles.rateBtnText}>Don't know</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    backgroundColor: colors.paper,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  closeX: { fontSize: 20, color: colors.textSecondary, fontWeight: '600' },
  progressTrack: {
    flex: 1, height: 10, borderRadius: 5,
    backgroundColor: colors.border, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 5 },
  progressLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, width: 40, textAlign: 'right' },
  body: { flex: 1, padding: 20 },
  prompt: {
    fontSize: 13, color: colors.textSecondary, textAlign: 'center',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  wordCard: {
    marginTop: 16, marginBottom: 24,
    paddingVertical: 36, paddingHorizontal: 20,
    borderRadius: 16, borderWidth: 2,
    backgroundColor: colors.paper,
    alignItems: 'center',
  },
  wordText: { fontSize: 32, fontWeight: '800', color: colors.text },
  translationSmall: { fontSize: 14, color: colors.textSecondary, marginTop: 6 },
  input: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.paper,
  },
  inputCorrect: { borderColor: '#4CAF50', backgroundColor: '#E8F5E9' },
  inputWrong: { borderColor: colors.error, backgroundColor: '#FFEBEE' },
  feedback: {
    marginTop: 16,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12,
  },
  feedbackCorrect: { backgroundColor: '#E8F5E9' },
  feedbackWrong: { backgroundColor: '#FFEBEE' },
  feedbackTitle: { fontSize: 16, fontWeight: '800', color: '#1B5E20', marginBottom: 4 },
  feedbackText: { fontSize: 14, color: colors.text },
  selfRateCol: { gap: 12, marginTop: 8 },
  rateBtn: {
    paddingVertical: 18, borderRadius: 14,
    alignItems: 'center',
  },
  rateBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  footer: { marginTop: 'auto', paddingVertical: 16, alignItems: 'center' },
  primaryBtn: {
    paddingVertical: 14, paddingHorizontal: 40,
    borderRadius: 14, width: '100%', alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  finishingText: { fontSize: 14, color: colors.textSecondary, marginTop: 16 },
  emptyText: { fontSize: 14, color: colors.textSecondary, marginBottom: 16 },
  exitBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.primary },
  exitBtnText: { color: '#FFFFFF', fontWeight: '700' },
  exitGhost: { paddingVertical: 10, paddingHorizontal: 20, marginTop: 8 },
  exitGhostText: { color: colors.textSecondary, fontWeight: '600' },
  errorText: { color: colors.error, marginBottom: 12, textAlign: 'center' },
});

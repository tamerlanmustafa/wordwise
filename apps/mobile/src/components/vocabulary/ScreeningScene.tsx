/**
 * ScreeningScene — the scene runner (#165). Turns MovieDetailScreen's
 * browsable deck into a paced lesson: study cards, a spot check partway
 * through, a scene test whose wrong answers come back until they are right,
 * and a complete screen.
 *
 *   [card 1..3] [spot check] [card 4..6] [Q1 Q2 Q3 · Q4 Q5 resurfaced]
 *
 * Everything here is wiring. The shape of a scene is `screeningLogic`
 * (#164), the progress on disk is `screeningStore`, the decisions between
 * them are `screeningRunner`, and every surface on screen already existed:
 * the study card is `WordCardDeck` (unchanged but for one opt-in prop that
 * ends its rotation), the questions are `MCQCard`, the chrome is
 * `QuizHeader`, the end is `SessionComplete`.
 *
 * Two rules the code exists to keep:
 *
 * 1. A SCENE IS NEVER LOST. Every beat transition and every answer is
 *    written to AsyncStorage as it happens, so quitting mid-scene — or a
 *    backgrounded app, or an empty energy meter once #168 lands — resumes
 *    at the same beat with the same running score. Nothing here can throw
 *    away a scene the reader is halfway through.
 * 2. THERE IS ONE MEMORY MODEL. Every answer posts to /srs/review against
 *    the same UserWord row the Practice tab reviews, so a word missed in a
 *    film on Tuesday comes back in Practice on Friday. Screening Mode
 *    stores which words a film has ASKED; the Leitner box stays server-side.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { srsApi, SrsPaywallError, type SrsReviewCard } from '../../services/api';
import { useScreeningStore } from '../../stores/screeningStore';
import { useThemeColors, type ThemeColors } from '../../theme/tokens';
import { cefrColors } from '../../theme/palette';
import { EmptyState } from '../common/EmptyState';
import { SessionComplete } from '../common/SessionComplete';
import { Skeleton } from '../ui/Skeleton';
import { MCQCard } from '../quiz/MCQCard';
import { QuizHeader } from '../quiz/QuizHeader';
import { feedback } from '../../utils/feedback';
import { WordCardDeck, type DeckItem, type WordCardDeckProps } from './WordCardDeck';
import { currentKey, linearReducer, startLinear, type LinearCursor } from './screeningLogic';
import {
  beatAfterCardRun,
  beatIndexForCard,
  cardRunStart,
  indexItems,
  questionBeatNeed,
  queueFromCards,
  resolveScene,
  wordsForBeat,
  type ResolvedScene,
  type RunnerItem,
} from './screeningRunner';

/** The deck props the runner passes straight through to the study card. */
type DeckPassthrough = Omit<
  WordCardDeckProps,
  'items' | 'initialWord' | 'onExhausted' | 'onAdvanceBookmark' | 'onCursorChange' | 'onMarkLearned'
>;

export interface ScreeningSceneProps {
  movieId: number;
  /** The film's deck in reading order — MovieDetailScreen's `deckItems`. */
  items: DeckItem[];
  /** Everything the study card needs that the lesson does not decide. */
  deck: DeckPassthrough;
  /** "I know this" on a study card — the film screen's own learned handler.
   *  Called alongside the store's `markKnown`, never instead of it. */
  onMarkLearned?: (term: string) => void;
  /** Deck advances still move the film's resume bookmark. */
  onAdvanceBookmark: (term: string) => void;
  /** Leave Screening Mode for the browsable deck. */
  onExit: () => void;
}

const isIdiomItem = (item: DeckItem): item is Extract<DeckItem, { phrase: string }> =>
  'phrase' in item;

/** Deck item → what the lesson needs: a key, a rank to order tests by, a word to ask for. */
function toRunnerItem(item: DeckItem): RunnerItem {
  if (isIdiomItem(item)) return { key: item.phrase, rank: null, word: item.phrase };
  return { key: item.word, rank: item.frequency_rank ?? null, word: item.word };
}

/** A card the runner can actually render; anything else is treated as absent. */
const isRenderable = (card: SrsReviewCard): boolean =>
  card.card_type === 'mcq' && Array.isArray(card.choices) && card.choices.length > 0;

const asCefr = (level: string | null | undefined): keyof typeof cefrColors | null =>
  level && level in cefrColors ? (level as keyof typeof cefrColors) : null;

const EMPTY_SCENE: ResolvedScene = {
  scenes: [],
  scene: null,
  cards: [],
  beats: [],
  beatKeys: [],
  beat: null,
  filmComplete: false,
};

export function ScreeningScene({
  movieId,
  items,
  deck,
  onMarkLearned,
  onAdvanceBookmark,
  onExit,
}: ScreeningSceneProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);

  const progress = useScreeningStore(s => s.byMovie[movieId]);
  const hydrated = useScreeningStore(s => movieId in s.byMovie);

  const runnerItems = useMemo(() => items.map(toRunnerItem), [items]);
  const byKey = useMemo(() => indexItems(runnerItems), [runnerItems]);
  const itemByKey = useMemo(() => {
    const map = new Map<string, DeckItem>();
    for (const item of items) map.set(toRunnerItem(item).key, item);
    return map;
  }, [items]);

  // Cards for the question beat in flight, keyed by deck key. Deliberately
  // NOT persisted: the queue is (it is what the reader still owes), and the
  // cards behind it are re-fetched on resume. `movie_lesson` is exempt from
  // the free daily cap, so re-asking for them costs a resumer nothing.
  const [cards, setCards] = useState<Map<string, SrsReviewCard>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [correctRun, setCorrectRun] = useState(0);
  const [cursor, setCursor] = useState<LinearCursor>(() => startLinear([], 0));
  /** Which scene the cursor above is a cursor OVER. Until it matches the
   *  stored scene the cursor means nothing, and an empty one reads as
   *  exhausted — which would flash the complete screen on arrival. */
  const [adoptedScene, setAdoptedScene] = useState<number | null>(null);

  const resolved = useMemo(
    () => (progress ? resolveScene(progress, byKey) : EMPTY_SCENE),
    [progress, byKey],
  );
  const beatSignature = resolved.beatKeys.join(' ');

  // Answer chimes for the whole scene — creating a player per tap hitches
  // the exact frame that is supposed to feel instant (#162).
  useEffect(() => {
    feedback.preload().catch(() => {});
    return () => feedback.release();
  }, []);

  useEffect(() => {
    if (!hydrated) void useScreeningStore.getState().hydrate(movieId);
  }, [hydrated, movieId]);

  // Android's back button leaves the lesson, not the film. Registered here
  // rather than in App.tsx's resolver because this is an overlay over a
  // screen that is still mounted: RN runs the most recently added listener
  // first, so ours wins for exactly as long as the lesson is on screen. A
  // no-op on iOS, where the film's own header chevron is the way out.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onExit();
      return true;
    });
    return () => sub.remove();
  }, [onExit]);

  // Begin a lesson over the deck as it stands. The keys are frozen from here
  // — scene boundaries must not move under a reader halfway through one —
  // so a level switch that changes the deck does not re-cut the film.
  useEffect(() => {
    if (!hydrated || progress || runnerItems.length === 0) return;
    useScreeningStore.getState().start({
      movieId,
      keys: runnerItems.map(i => i.key),
      scene: 0,
      beat: 0,
      queue: null,
      missed: [],
      tested: [],
      known: [],
      got: 0,
      forgot: 0,
    });
  }, [hydrated, progress, runnerItems, movieId]);

  // Adopt the stored beat on arrival and whenever the scene changes; after
  // that keep the cursor in step with beats that shift underneath it (a card
  // swiped "I know this" leaves the scene and its tests).
  //
  // A LAYOUT effect, not a passive one: between "next scene" and this running,
  // the cursor belongs to the scene that just ended and the screen has nothing
  // to draw. A passive effect would paint that frame — one flash of skeleton
  // on every scene transition, which is precisely the moment that should feel
  // like a continuation.
  useLayoutEffect(() => {
    if (!progress || !resolved.scene) return;
    if (adoptedScene !== progress.scene) {
      setAdoptedScene(progress.scene);
      setCursor(startLinear(resolved.beatKeys, progress.beat));
      return;
    }
    setCursor(c => linearReducer(c, { type: 'sync', keys: resolved.beatKeys }));
    // Keyed on the beat list, not on `progress`: re-syncing on every answer
    // would fight the cursor moves below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.scene, beatSignature, adoptedScene]);

  const fetchingRef = useRef<string | null>(null);

  /** Move to a beat and persist it. Every transition clears the queue: a
   *  card beat has none, and a question beat composes its own on arrival.
   *  `keys` is passed rather than read from the cursor because the caller
   *  may know a beat list this render has not seen yet — swiping a card
   *  "I know this" re-shapes the scene inside the same tick. */
  const goToBeat = useCallback(
    (index: number, keys: readonly string[]) => {
      setCursor(startLinear([...keys], index));
      setCards(new Map());
      setError(null);
      fetchingRef.current = null;
      useScreeningStore.getState().update(movieId, { beat: index, queue: null });
    },
    [movieId],
  );

  const ready = progress != null && adoptedScene === progress.scene;
  const beat = ready ? (resolved.beats[cursor.index] ?? null) : null;
  const queue = progress?.queue ?? null;
  const head = queue && queue.length > 0 ? queue[0] : null;
  const headCard = head ? cards.get(head.key) : null;
  const need = questionBeatNeed(beat, queue, cards.size);

  const startNextScene = useCallback(() => {
    if (!progress) return;
    useScreeningStore.getState().update(movieId, {
      scene: progress.scene + 1,
      beat: 0,
      queue: null,
      got: 0,
      forgot: 0,
    });
    setCorrectRun(0);
  }, [movieId, progress]);

  // A scene whose every card was swiped "I know this" has nothing to run.
  // Step over it rather than showing a 0-of-0 complete screen; the walk ends
  // because each step moves the stored scene forward exactly once.
  useEffect(() => {
    if (!ready || !resolved.scene || resolved.beats.length > 0) return;
    startNextScene();
  }, [ready, resolved.scene, resolved.beats.length, startNextScene]);

  // ── The question beats ──────────────────────────────────────────────────
  // One effect covers both ways a question beat can need cards: composing a
  // fresh queue, and re-fetching the cards behind a queue restored from
  // disk.
  //
  // `loading` is deliberately NEITHER a guard nor a dependency here. It is
  // set inside the effect, so listing it would re-run the effect, fire this
  // cleanup, and cancel the very fetch that had just started — the scene
  // would sit on a skeleton for ever. The ref below is the real guard: it
  // holds the beat being fetched, so a re-render mid-flight is a no-op.
  useEffect(() => {
    if (!progress || error) return;
    if (need !== 'compose' && need !== 'rehydrate') return;
    const token = `${progress.scene}:${cursor.index}:${need}`;
    if (fetchingRef.current === token) return;
    fetchingRef.current = token;

    const questions = queue ?? wordsForBeat(beat, progress, resolved, byKey);
    if (questions.length === 0) {
      goToBeat(cursor.index + 1, resolved.beatKeys);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const session = await srsApi.startSession({
          kind: 'movie_lesson',
          movieId,
          words: questions.map(q => byKey.get(q.key)?.word ?? q.key),
        });
        if (cancelled) return;
        const { queue: next, byKey: cardsByKey } = queueFromCards(
          questions,
          session.cards.filter(isRenderable),
        );
        // Every word came back uncardable — a cold language, or a scene of
        // idioms. Skipping the beat is the only move that does not strand
        // the reader on a question that can never be asked.
        if (next.length === 0) {
          goToBeat(cursor.index + 1, resolved.beatKeys);
          return;
        }
        setCards(cardsByKey);
        useScreeningStore.getState().update(movieId, { queue: next });
      } catch (e: any) {
        if (cancelled) return;
        // A paywall here means a backend that has not learned `movie_lesson`
        // is exempt from the daily cap. Surface it as something the reader
        // can retry rather than as a lost scene.
        const message =
          e instanceof SrsPaywallError
            ? t('vocabulary:screening.capped')
            : t('vocabulary:screening.startFailed');
        console.warn('[ScreeningScene] lesson start failed:', e?.message);
        setError(message);
      } finally {
        // Unconditional: a cancelled fetch that left `loading` true would
        // strand the reader on the skeleton with nothing coming.
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.scene, cursor.index, need, queue, error]);

  // A question beat whose queue has emptied is finished — every question was
  // answered right at least once, which is the rule requeue exists to keep.
  useEffect(() => {
    if (need !== 'empty') return;
    goToBeat(cursor.index + 1, resolved.beatKeys);
  }, [need, cursor.index, resolved.beatKeys, goToBeat]);

  const handleAnswer = useCallback(
    (correct: boolean) => {
      if (!head) return;
      const card = cards.get(head.key);
      if (card) {
        // Fire and forget, exactly as ReviewScreen does: a dropped review
        // costs the reader one extra sighting of the word, never the scene.
        srsApi.review(card.user_word_id, correct).catch(e => {
          console.warn('[ScreeningScene] review record failed:', e?.message);
        });
      }
      setCorrectRun(r => (correct ? r + 1 : 0));
      // Re-key the card so a requeued question that comes round again mounts
      // clean instead of showing its previous answer.
      setAttempt(a => a + 1);
      useScreeningStore.getState().answer(movieId, correct);
    },
    [head, cards, movieId],
  );

  const handleMarkKnown = useCallback(
    (term: string) => {
      useScreeningStore.getState().markKnown(movieId, term);
      onMarkLearned?.(term);
    },
    [movieId, onMarkLearned],
  );

  // The deck reports its new focused card. Resolved against the store as it
  // is RIGHT NOW, not against this render: "I know this" fires markKnown and
  // this callback in the same tick, and the beat list between them is not
  // the one the render closed over.
  const handleDeckAdvance = useCallback(
    (term: string) => {
      onAdvanceBookmark(term);
      const live = useScreeningStore.getState().byMovie[movieId];
      if (!live) return;
      const fresh = resolveScene(live, byKey);
      const index = beatIndexForCard(fresh.beatKeys, term);
      // -1 means the card is not a beat of this scene any more; the cursor's
      // own sync has already handled that, so leave it alone.
      if (index >= 0) goToBeat(index, fresh.beatKeys);
    },
    [onAdvanceBookmark, movieId, byKey, goToBeat],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  const sceneNumber = (progress?.scene ?? 0) + 1;
  const sceneCount = resolved.scenes.length;
  const chip = t('vocabulary:screening.sceneOf', { scene: sceneNumber, total: sceneCount });
  const title = deck.movieTitle ?? '';

  const shell = (children: React.ReactNode, header: React.ReactNode) => (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}
      {children}
    </SafeAreaView>
  );

  const waiting = (
    <View style={styles.skeleton}>
      <Skeleton height={160} radius={16} sheen />
      <Skeleton height={52} radius={12} sheen delay={140} />
      <Skeleton height={52} radius={12} sheen delay={200} />
      <Skeleton height={52} radius={12} sheen delay={260} />
    </View>
  );

  if (!hydrated || (!progress && runnerItems.length > 0)) {
    return shell(waiting, <QuizHeader movie={title} onBack={onExit} />);
  }

  if (!progress || sceneCount === 0) {
    return shell(
      <EmptyState
        icon="film-outline"
        title={t('vocabulary:screening.emptyTitle')}
        body={t('vocabulary:screening.emptyBody')}
        ctaLabel={t('vocabulary:screening.browse')}
        onCta={onExit}
      />,
      <QuizHeader movie={title} onBack={onExit} />,
    );
  }

  // Every scene of the film is behind us. The Final Cut and the mastery ring
  // are #172; until then the film hands the reader back to the deck.
  if (resolved.filmComplete || !resolved.scene) {
    return shell(
      <SessionComplete
        eyebrow={t('vocabulary:screening.eyebrow')}
        title={t('vocabulary:screening.filmDone')}
        stats={[
          { value: sceneCount, label: 'scenes', accent: true },
          { value: progress.tested.length, label: 'tested' },
          { value: progress.keys.length, label: 'words' },
        ]}
        primaryLabel={t('vocabulary:screening.browse')}
        onPrimary={onExit}
        celebrate
      />,
      <QuizHeader movie={title} onBack={onExit} />,
    );
  }

  if (error) {
    return shell(
      <EmptyState
        icon="cloud-offline-outline"
        tone="error"
        title={t('quiz:review.errorTitle')}
        body={`${error}\n\n${t('vocabulary:screening.progressSafe')}`}
        ctaLabel={t('action.retry')}
        onCta={() => {
          fetchingRef.current = null;
          setError(null);
        }}
        subCtaLabel={t('vocabulary:screening.browse')}
        onSubCta={onExit}
      />,
      <QuizHeader movie={chip} onBack={onExit} />,
    );
  }

  if (!ready) return shell(waiting, <QuizHeader movie={chip} onBack={onExit} />);

  const beatCount = resolved.beats.length;
  const headerProgress = { index: Math.min(cursor.index + 1, beatCount), total: beatCount };

  // Scene complete: the cursor ran off the end of the beats.
  if (cursor.exhausted || !beat) {
    const answered = progress.got + progress.forgot;
    const pct = answered > 0 ? Math.round((progress.got / answered) * 100) : 0;
    const isLast = progress.scene + 1 >= sceneCount;
    return shell(
      <SessionComplete
        eyebrow={t('vocabulary:screening.eyebrow')}
        title={t('vocabulary:screening.sceneComplete')}
        stats={[
          { value: pct, suffix: '%', label: 'accuracy', accent: true },
          { value: progress.got, label: 'remembered' },
          { value: answered, label: 'answered' },
        ]}
        // Both paths advance the scene: on the last one that lands on the
        // film-complete screen, which is the celebration worth ending on.
        primaryLabel={isLast ? t('action.done') : t('vocabulary:screening.nextScene')}
        onPrimary={startNextScene}
        secondaryLabel={t('vocabulary:screening.browse')}
        onSecondary={onExit}
        celebrate
      />,
      <QuizHeader movie={chip} onBack={onExit} />,
    );
  }

  if (beat.kind === 'card') {
    // The run of cards this beat belongs to, swiped through as a deck.
    // `onExhausted` is what ends the run at the spot check or the test
    // instead of wrapping back to its first card.
    const runStart = cardRunStart(resolved.beats, cursor.index);
    const runEnd = beatAfterCardRun(resolved.beats, cursor.index);
    const runItems: DeckItem[] = [];
    for (let i = runStart; i < runEnd; i++) {
      const b = resolved.beats[i];
      const item = b?.kind === 'card' ? itemByKey.get(b.key) : null;
      if (item) runItems.push(item);
    }
    const focused = currentKey(cursor)?.replace(/^card:/, '') ?? null;
    const item = focused ? itemByKey.get(focused) : null;
    // A word carries no level of its own — the deck is already filtered to
    // one, which is what the browsing header shows. Only idioms are labelled
    // individually, so they win when the focused card is one.
    const cardLevel = item && isIdiomItem(item) ? item.cefr_level : deck.activeLevel;

    return shell(
      <View style={styles.body}>
        <WordCardDeck
          {...deck}
          key={`screening-${progress.scene}-${runStart}`}
          items={runItems}
          initialWord={focused}
          onMarkLearned={handleMarkKnown}
          onAdvanceBookmark={handleDeckAdvance}
          onExhausted={() => goToBeat(runEnd, resolved.beatKeys)}
        />
      </View>,
      <QuizHeader
        movie={chip}
        level={asCefr(cardLevel)}
        index={headerProgress.index}
        total={headerProgress.total}
        onBack={onExit}
      />,
    );
  }

  if (loading || !head || !headCard?.choices) {
    return shell(
      waiting,
      <QuizHeader movie={chip} {...headerProgress} onBack={onExit} />,
    );
  }

  return shell(
    <View style={styles.body}>
      <MCQCard
        key={`screening-q-${head.key}-${attempt}`}
        word={headCard.word}
        pos={headCard.pos ?? undefined}
        example={headCard.example_sentence}
        choices={headCard.choices}
        onAnswer={handleAnswer}
        correctRun={correctRun}
      />
    </View>,
    <QuizHeader
      movie={chip}
      level={asCefr(headCard.cefr_level)}
      {...headerProgress}
      onBack={onExit}
    />,
  );
}

const makeStyles = (tc: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: tc.background },
    body: { flex: 1 },
    skeleton: { padding: 20, gap: 16 },
  });

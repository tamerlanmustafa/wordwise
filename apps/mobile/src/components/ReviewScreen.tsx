import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  srsApi,
  SrsPaywallError,
  type SessionKind,
  type SrsReviewCard,
  type SrsSessionStart,
} from '../services/api';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { usePracticePathStore } from '../stores/practicePathStore';
import { useQuizGuardStore } from '../stores/quizGuardStore';
import { useMilestoneTrackerStore } from '../stores/milestoneTrackerStore';
import { useReviewSessionStore } from '../stores/reviewSessionStore';
import { useReminderStore } from '../stores/reminderStore';
import { MilestoneUnlockModal } from './journey/MilestoneUnlockModal';
import { QuizHeader } from './quiz/QuizHeader';
import { MCQCard } from './quiz/MCQCard';
import { isChoiceCard } from './quiz/mcqLogic';
import { isPracticeSession } from './quiz/sessionCredit';
import { QuizCardSkeleton } from './quiz/QuizCardSkeleton';
import { sessionPosition } from './quiz/quizHeaderLayout';
import { emptyDeckCopy } from './quiz/emptyDeck';
import { feedback } from '../utils/feedback';
import { useThemeColors, type ThemeColors } from '../theme/tokens';
import { EmptyState } from './common/EmptyState';
import type { PaywallReason } from './paywallPricing';
import { SessionComplete } from './common/SessionComplete';

// Leitner review session UI — also the v0.6 "daily 2-min" habit anchor.
//
// Flow:
//   1. POST /srs/session/start → get up to N due cards (or 402 → paywall:
//      "srs_daily_cap_reached" for free users who already did today, or
//      legacy "srs_preview_exhausted" for older backends).
//   2. Card shows word. Tap "Show answer" → reveal definition/sentence.
//   3. "Got it" / "Forgot" → POST /srs/review, advance to next card.
//   4. When the stack empties → summary screen. Completing the session
//      bumps `dailyGoalStore` — that's how the streak counter and
//      "Today's done" pill on JourneyScreen know the habit is satisfied.
//
// This component intentionally keeps definition/translation lookup on the
// client side of the SRS loop: the review endpoint only records outcomes.
// If we want richer card content later (examples, images, audio), extend
// /srs/session/start to include it rather than fanning out N extra calls.

export interface ReviewScreenProps {
  /** Which queue to draw from. Omit for the Practice tab's default. */
  kind?: SessionKind;
  /** Set for the Lists tab's `list_words` / `list_films` kinds. Scopes the
   *  resume cache so quitting a list session and opening Practice doesn't
   *  try to resume the wrong deck. */
  listId?: number;
  /** A session the caller already started, used by the Lists tab: its gold
   *  button hits POST /lists/{id}/practice so it can 409 on an empty pool
   *  *before* navigating here. Starting a second one would consume two of a
   *  free user's one-per-day sessions, so when this is present we adopt it
   *  instead of calling /srs/session/start again. */
  initialSession?: SrsSessionStart;
  onBack: () => void;
  /** `reason` picks the paywall's copy. The daily cap and the legacy preview
   *  budget both arrive as a 402 and need different sentences — without it
   *  the cap rendered the preview sentence over counts the payload never
   *  sent, i.e. "You've used 0 of 0 free review sessions". */
  onPaywall: (
    previews_used: number,
    previews_limit: number,
    reason: PaywallReason,
  ) => void;
}

// v0.7 §7 — `recall` is gone. The server only ships translation `mcq`
// cards now, which own their own internal interaction state, so the
// screen-level phase machine only tracks the high-level session
// lifecycle.
type Phase = 'loading' | 'card' | 'done' | 'empty' | 'error';

export function ReviewScreen({
  kind,
  listId,
  initialSession,
  onBack,
  onPaywall,
}: ReviewScreenProps) {
  const { t } = useTranslation();
  const tc = useThemeColors();
  const styles = useMemo(() => makeStyles(tc), [tc]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [cards, setCards] = useState<SrsReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ got: 0, forgot: 0 });
  // Per-question results, in order, for the header's segmented bar. `stats`
  // only totals them, and the bar has to colour each segment individually.
  const [outcomes, setOutcomes] = useState<boolean[]>([]);
  const [previewsRemaining, setPreviewsRemaining] = useState<number | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Cards already answered before this run — non-zero only when we resumed a
  // cached deck. `cards` holds just what is left, so without this the header
  // counted the tail: "1 / 7" for a session the user was 3 cards into.
  const [answeredBefore, setAnsweredBefore] = useState(0);
  // Why the deck came back empty, when it did. Distinguishes "you're caught
  // up" from "we couldn't build your cards" — see `quiz/emptyDeck.ts`.
  const [deckStatus, setDeckStatus] = useState<string | undefined>(undefined);
  // Bump info for the streak/wall on the done screen. Populated once when
  // the session finishes; not re-bumped on re-renders.
  const [dailySummary, setDailySummary] = useState<{
    streak: number;
    justHitGoal: boolean;
  } | null>(null);
  // The chest used to live here — two pieces of state and an overlay, fed by
  // `res.chest` from the completion call.
  //
  // It is OFF: `backend/src/services/chest_service.py` holds the switch and
  // the whole reasoning, and the server answers every completion with
  // `chest: null`. The state is gone rather than left inert, because state
  // that can never change is a trap for the next reader — two `useState` lines
  // are cheap to restore, and `ChestReveal` is still on disk with the picker,
  // the weights and their tests untouched. Paused, not abandoned.
  // Answer chimes, loaded for the length of the session (see QuizLessonScreen).
  useEffect(() => {
    void feedback.preload();
    return () => {
      void feedback.release();
    };
  }, []);

  // Milestone unlock queue. completeSession returns the full inventory;
  // we diff against AsyncStorage "seen" to find new ones and present
  // them one at a time (rare multi-cross scenarios get serialized).
  const [milestoneQueue, setMilestoneQueue] = useState<string[]>([]);
  const milestoneHydrate = useMilestoneTrackerStore((s) => s.hydrate);
  const milestoneHydrated = useMilestoneTrackerStore((s) => s.hydrated);
  useEffect(() => {
    if (!milestoneHydrated) milestoneHydrate();
  }, [milestoneHydrated, milestoneHydrate]);

  const fade = useRef(new Animated.Value(1)).current;

  /**
   * The Practice tab is a path of tiles; a Lists deck is a one-off. Only the
   * former gets the "Next" loop — offering it on a list would either replay
   * the same deck or silently start a *practice* session from inside Lists.
   *
   * The same predicate now also decides whether finishing this deck counts as
   * today's practice, which is not a coincidence: "does the path continue" and
   * "does the day advance" were always the same question, and the bug was that
   * only the first one was asking it. See `quiz/sessionCredit`.
   */
  const isPracticePath = isPracticeSession(kind, listId);

  /**
   * `initialSession` is a deck the caller already started (Lists). It must be
   * adopted exactly once: reusing it on a later load would serve the same
   * cards forever, which is precisely what a "Next" button would trigger.
   */
  const initialSessionSpent = useRef(false);
  /** The server's `practice_sessions` row for the deck on screen, from
   *  `session/start` — or from the cache, for a deck resumed after the app was
   *  quit. Null only for a deck dealt by an older server or cached before the
   *  store carried the id; the completion then falls back to trusting the
   *  counts, exactly as it always did. */
  const sessionIdRef = useRef<number | null>(null);

  const loadSession = useCallback(async () => {
    setPhase('loading');
    setIndex(0);
    setStats({ got: 0, forgot: 0 });
    setOutcomes([]);

    // v0.7 §7 — try resuming a cached in-flight session before hitting
    // the server. The cache is scoped by kind (+ listId for the Lists
    // kinds) and expires after 24h; if it's not eligible we fall through
    // to a fresh /srs/session/start. We need the store hydrated first so
    // resumable() reads from AsyncStorage, not stale defaults.
    const session_store = useReviewSessionStore.getState();
    if (!session_store.hydrated) {
      await session_store.hydrate();
    }
    const resolvedKind: SessionKind = kind ?? 'practice';
    // List sessions key their cache on the list; Practice has one deck.
    const scopeId = listId;
    const resumable = useReviewSessionStore.getState().resumable(resolvedKind, scopeId);
    if (resumable) {
      setCards(resumable.remaining);
      // The deal this deck came from, recovered with it. A resumed deck is
      // still the SAME deal on the server — finishing it must clamp, stamp and
      // claim against that row, or the day the user just practised draws as a
      // gap in the week strip while the streak counts it.
      sessionIdRef.current = resumable.sessionId ?? null;
      setIsPreview(false);
      setPreviewsRemaining(null);
      setStats({ got: resumable.got, forgot: resumable.forgot });
      // A resumed deck knows its totals but not the order they came in, so the
      // recovered segments are grouped rather than interleaved. The count is
      // right, which is what the bar is for; pretending to know the sequence
      // would be inventing data.
      setOutcomes([
        ...Array(resumable.got).fill(true),
        ...Array(resumable.forgot).fill(false),
      ]);
      // `totalCards` is the whole session; `remaining` is what's left. The
      // difference is what the header has to add back so a resumed deck
      // reads "4 / 10" rather than restarting the count at "1 / 7".
      setAnsweredBefore(Math.max(0, resumable.totalCards - resumable.remaining.length));
      setDeckStatus('ok');
      setPhase('card');
      return;
    }

    try {
      // `kind` picks the queue composer. Undefined hits the backend's
      // `practice` default, which is what the Practice tab wants.
      const adopt = initialSessionSpent.current ? null : initialSession;
      initialSessionSpent.current = true;
      const session = adopt ?? await srsApi.startSession({ kind });
      setCards(session.cards);
      setIsPreview(session.is_preview);
      setPreviewsRemaining(session.previews_remaining);
      setAnsweredBefore(0);
      setDeckStatus(session.deck_status);
      // The server's id for this deal. Handed back on completion so it can
      // clamp our reported counts to the cards it actually dealt — before
      // this, the streak was whatever this screen claimed it was. A ref
      // rather than state: nothing renders from it, and a re-render between
      // the last card and the completion call must not lose it.
      sessionIdRef.current = session.session_id ?? null;
      if (session.cards.length === 0) {
        setPhase('empty');
      } else {
        setPhase('card');
        // Cache the fresh session so a future quit-and-reopen resumes
        // the same deck (within 24h, same kind + list).
        useReviewSessionStore.getState().start({
          kind: resolvedKind,
          scopeId: scopeId ?? null,
          // Cached WITH the deck: the ref above dies with the process, and a
          // deck resumed tomorrow morning has to complete against the same
          // deal row it was dealt from.
          sessionId: sessionIdRef.current,
          remaining: session.cards,
          got: 0,
          forgot: 0,
          totalCards: session.cards.length,
        });
      }
    } catch (e: any) {
      if (e instanceof SrsPaywallError) {
        onPaywall(e.previews_used, e.previews_limit, e.kind);
        return;
      }
      console.warn('[ReviewScreen] startSession failed:', e?.message);
      setErrorMessage(e?.message || t('quiz:review.startFailed'));
      setPhase('error');
    }
  }, [onPaywall, kind, listId, initialSession, t]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // The guard tracks "a deck is on screen and answerable", which is exactly
  // the `card` phase. The unmount clear is the important half: a paywall
  // redirect or a parent-driven navigation can take this screen away without
  // ever passing through the done screen, and a flag left raised would make
  // the *next* unrelated back press ask about a quiz that no longer exists.
  useEffect(() => {
    useQuizGuardStore.getState().setInProgress(phase === 'card');
  }, [phase]);
  useEffect(() => () => useQuizGuardStore.getState().setInProgress(false), []);

  /**
   * Finish this tile and open the next one without leaving the screen.
   *
   * Everything the finished session left behind has to be cleared by hand:
   * the streak card, the chest, the milestone queue. `loadSession` resets the
   * deck itself but knows nothing about the done screen's state, so skipping
   * this shows the next tile carrying the last one's celebration.
   */
  const startNextTile = useCallback(() => {
    setDailySummary(null);
    setMilestoneQueue([]);
    setAnsweredBefore(0);
    setDeckStatus(undefined);
    setErrorMessage(null);
    void loadSession();
  }, [loadSession]);

  const currentCard = cards[index];

  // v0.7 §7 — skip any card the client can't render (server shouldn't
  // emit these post-refactor, but old server builds could). We do it
  // in an effect so render stays pure and the skip fires exactly once
  // per card index.
  useEffect(() => {
    if (phase !== 'card' || !currentCard) return;
    const renderable = isChoiceCard(currentCard.card_type) && currentCard.choices;
    if (renderable) return;
    console.warn('[ReviewScreen] skipping unrenderable card:', currentCard.card_type, currentCard.word);
    // `record: false` — the user never saw this card, so posting an outcome
    // for it would push a word they were never asked up the Leitner boxes
    // and out to a 30-day interval on the strength of a card the client
    // couldn't draw. Skipping silently leaves it due, which is the truth.
    advance(true, { record: false });
    // We intentionally exclude `advance` from deps to avoid the effect
    // re-running on every advance() call (which mutates state on the
    // next render). Keying off currentCard + phase fires once per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCard, phase]);

  const advance = useCallback(
    (correct: boolean, opts?: { record?: boolean }) => {
      if (!currentCard) return;
      const record = opts?.record ?? true;
      // Fire-and-forget the review POST. If it fails the scheduler will
      // just show the card again on the next session — worst case a user
      // sees a word one extra time, not a silent data-loss bug. The *day*
      // is no longer riding on these: /srs/session/complete records that
      // separately, so a flaky connection can no longer eat the streak.
      // Pop the card from the persistent cache either way, so a quit-and-
      // reopen resumes at the NEXT one. Stats inside the store mirror ours so
      // /srs/session/complete totals stay coherent on resume.
      const cache = useReviewSessionStore.getState();
      if (record) {
        srsApi.review(currentCard.user_word_id, correct).catch((e) => {
          console.warn('[ReviewScreen] review record failed:', e?.message);
        });
        setStats((s) => ({
          got: s.got + (correct ? 1 : 0),
          forgot: s.forgot + (correct ? 0 : 1),
        }));
        setOutcomes((prev) => [...prev, correct]);
        cache.consume(correct);
      } else {
        cache.skip();
      }

      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();

      if (index + 1 >= cards.length) {
        // Session complete — clear the persistent cache first so a
        // future open of the same tile gets a fresh queue.
        useReviewSessionStore.getState().clear();
        // Everything in this block is one-per-day, so only the Practice tab's
        // own deck may touch it. A list is extra practice the user went and
        // asked for; crediting it let three words stand in for the lesson and,
        // worse, *spent* the day, so the real lesson later found the chest
        // claimed and the cursor already moved. See `quiz/sessionCredit`.
        if (isPracticePath) {
          // Anchor the daily streak. Bump is idempotent for same-day
          // repeats (a free user can only start once per UTC day anyway,
          // but premium users hitting multiple sessions today shouldn't
          // inflate the streak).
          const bump = useDailyGoalStore.getState().bump();
          setDailySummary({ streak: bump.streak, justHitGoal: bump.justHitGoal });
          // v0.7.3 — advance the Practice-path cursor so the next tile
          // becomes active. The store debounces against accidental
          // double-fires within the same completion.
          usePracticePathStore.getState().advance();
        }
        // The deck is finished, so leaving is no longer destructive — drop the
        // guard before the done screen renders, or its own CTAs would prompt.
        useQuizGuardStore.getState().setInProgress(false);
        // Today is done, so tonight's reminder would be a lie. Re-arming
        // cancels the pending set and schedules from tomorrow — which is also
        // what keeps a daily user from ever seeing the notification at all,
        // and what makes the series run out for someone who stops.
        //
        // Not awaited: it touches the OS scheduler, and the done screen should
        // not wait on it.
        void useReminderStore.getState().reschedule({
          title: t('settings:reminderTitle'),
          body: t('settings:reminderBody'),
        });

        // Report the completion. Fire and forget — if the network is flaky we
        // still show the done screen. The server enforces one-per-day on
        // everything this credits, so a retry won't double-count.
        const scored = record ? 1 : 0;
        const justCorrect = correct && record ? stats.got + 1 : stats.got;
        const total = stats.got + stats.forgot + scored;
        // Still called for a list — the server is the authority on what a
        // completion is worth, and it needs the kind to make that call for
        // installed builds too. It simply writes nothing one-per-day for a
        // list and answers with a null chest.
        //
        // `isPracticePath` rather than `kind` alone, because only it has seen
        // the list id. A list session whose `kind` came back undefined would
        // otherwise be *claimed* as practice; sending nothing instead lets the
        // server fall back to the kind it stamped at session start, which is
        // the right one.
        srsApi.completeSession(
          justCorrect,
          total,
          isPracticePath ? 'practice' : kind,
          sessionIdRef.current,
        )
          .then((res) => {
            // `res.chest` is null for every completion while the chest is off.
            // The branch that rendered it is gone rather than left behind a
            // condition that is always false — a reader should not have to
            // check the server to know whether an overlay can appear.
            // Correct the optimistic local streak with the server's. The
            // local one is computed from the device calendar and the server's
            // from UTC, and a fresh install starts at zero however long the
            // user's real streak is — so the done screen could say "Nice
            // work" while the Practice header, which reads the server, said
            // "day 12" one tap later. /srs/session/complete now records the
            // session itself, which makes this number the authoritative one.
            //
            // Gated on the same predicate as the bump it corrects. The server
            // returns the account's real streak whatever the deck was, so a
            // list session would otherwise end on "Streak extended — day 12"
            // having extended nothing: the number is true, the sentence is a
            // lie, and it is the sentence the user reads.
            if (isPracticePath && typeof res.streak === 'number' && res.streak > 0) {
              setDailySummary((prev) => ({
                streak: res.streak,
                justHitGoal: prev?.justHitGoal ?? false,
              }));
            }
            // Same correction for the lesson number. The optimistic advance
            // above is this install's count; the server keeps the account's,
            // which is what a second phone will see. `adopt` only ever raises,
            // so a reply that is merely equal — the normal case — is a no-op.
            usePracticePathStore.getState().adopt(res.lessons_completed);
            // v0.6 W10 — queue any newly-crossed milestones for celebration.
            // We don't markSeen here; that happens when the user dismisses
            // each modal so a crash mid-queue doesn't lose the unlock.
            const tracker = useMilestoneTrackerStore.getState();
            if (tracker.hydrated && res.unlocked_cosmetics?.length) {
              const fresh = tracker.newSince(res.unlocked_cosmetics);
              if (fresh.length > 0) setMilestoneQueue(fresh);
            }
          })
          .catch((e) => {
            console.warn('[ReviewScreen] completeSession failed:', e?.message);
          });
        setPhase('done');
      } else {
        setIndex(index + 1);
        // Phase stays 'card' — the next card mounts on the same surface.
      }
    },
    [currentCard, index, cards.length, fade, stats, isPracticePath, kind, t]
  );

  if (phase === 'loading') {
    // The same chrome the deck itself runs in. This used to render a paper bar
    // with a "← Back" text label above a stack of loose bars — so the entire
    // top of the screen changed shape the instant the first card arrived, on
    // top of the card body changing too. QuizHeader with no index/total drops
    // the counter and the progress bar and holds their slot with a spacer, so
    // loading gains those two pieces rather than being replaced.
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <QuizHeader onBack={onBack} />
        <QuizCardSkeleton />
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <QuizHeader onBack={onBack} />
        <EmptyState
          icon="cloud-offline-outline"
          tone="error"
          title={t('quiz:review.errorTitle')}
          body={`${errorMessage}\n\nDon't worry — your progress is saved.`}
          ctaLabel={t('action.retry')}
          onCta={loadSession}
          subCtaLabel="Continue offline"
          onSubCta={onBack}
        />
      </SafeAreaView>
    );
  }

  if (phase === 'empty') {
    // Two different empty decks, two different things to tell the user —
    // "come back tomorrow" vs "try again in a moment". See `quiz/emptyDeck`.
    const copy = emptyDeckCopy(deckStatus);
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <QuizHeader onBack={onBack} />
        <EmptyState
          icon={copy.icon}
          tone={copy.tone}
          title={t(copy.titleKey)}
          body={t(copy.bodyKey)}
          ctaLabel={t(copy.ctaKey)}
          onCta={copy.retry ? loadSession : onBack}
          subCtaLabel={copy.retry ? t('quiz:review.backHome') : undefined}
          onSubCta={copy.retry ? onBack : undefined}
        />
      </SafeAreaView>
    );
  }

  if (phase === 'done') {
    const total = stats.got + stats.forgot;
    const pct = total > 0 ? Math.round((stats.got / total) * 100) : 0;
    const streak = dailySummary?.streak ?? 0;
    const justHitGoal = dailySummary?.justHitGoal ?? false;
    // A list deck is not the daily review, and the eyebrow was the last place
    // the two were still conflated. The streak no longer moves for it, so a
    // heading that still called it the daily review would be the one remaining
    // sentence telling the user it had. (`dailySummary` stays null for a list,
    // which is what already drops the "Streak extended" title below.)
    const eyebrow = t(
      isPracticePath ? 'quiz:review.dailyReview' : 'quiz:review.listPractice',
    );
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Same chrome as the card screens the user just came through —
            round back button, gold-edged chip on the app background — minus
            the counter and progress bar, which have nothing left to report.
            This used to be a paper bar with a "← Back" text label, which
            read as a different screen from the deck it ends. */}
        <QuizHeader onBack={onBack} />
        <SessionComplete
          eyebrow={eyebrow}
          title={
            streak > 0
              ? t(justHitGoal ? 'quiz:review.streakExtendedGoal' : 'quiz:review.streakExtended', { streak })
              : t('quiz:review.niceWork')
          }
          stats={[
            { value: pct, suffix: '%', label: 'accuracy', accent: true },
            { value: stats.got, label: 'remembered' },
            { value: total, label: 'reviewed' },
          ]}
          // The loop: finishing a tile opens the next one, so the path keeps
          // going until the user says otherwise. The secondary button is that
          // "otherwise" — an explicit exit, so staying in is the default but
          // leaving is never more than one tap.
          primaryLabel={isPracticePath ? t('quiz:review.nextLesson') : t('quiz:review.done')}
          onPrimary={isPracticePath ? startNextTile : onBack}
          secondaryLabel={isPracticePath ? t('quiz:review.finishForNow') : undefined}
          onSecondary={isPracticePath ? onBack : undefined}
          outcomes={outcomes}
          celebrate
        >
          {isPreview && previewsRemaining === 0 ? (
            <Text style={styles.previewHint}>
              {t('quiz:review.upgradeBody')}
            </Text>
          ) : null}
        </SessionComplete>
        <MilestoneUnlockModal
          slug={milestoneQueue[0] ?? null}
          onDismiss={() => {
            // Mark just-shown slug as seen, then advance the queue. If
            // multiple were unlocked in the same bump, the next one
            // springs in on the next render.
            const [shown, ...rest] = milestoneQueue;
            if (shown) {
              void useMilestoneTrackerStore.getState().markSeen([shown]);
            }
            setMilestoneQueue(rest);
          }}
        />
      </SafeAreaView>
    );
  }

  // v0.7 §7 — every card is a translation mcq. The server skips any
  // word that can't build one, so we should never see anything else
  // here. If we do (old server build), drop the card on the floor and
  // advance silently so the queue doesn't black-screen.
  if (!currentCard) {
    // A frame-long gap between two cards, not a load — but a bare spinner on
    // an otherwise blank screen is the most alarming thing the deck can show,
    // and it appeared with no header at all. The card outline says "next one
    // is coming" using the shape that is actually coming.
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <QuizHeader onBack={onBack} />
        <QuizCardSkeleton />
      </SafeAreaView>
    );
  }

  // Count across the whole session, not just the cards still loaded — a
  // resumed deck holds only what's left (see `sessionPosition`).
  const pos = sessionPosition(index, cards.length, answeredBefore);
  const sharedHeader = (
    <QuizHeader
      // No title chip and no level badge. The level moved onto the word card
      // (see quiz/WordCard): a Practice deck mixes bands, so a level in the
      // top bar was describing whichever card was on screen and changed as
      // you answered — it read as a property of the session.
      index={pos.index}
      total={pos.total}
      outcomes={outcomes}
      onBack={onBack}
    />
  );
  if (isChoiceCard(currentCard.card_type) && currentCard.choices) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {sharedHeader}
        <Animated.View style={[{ flex: 1 }, { opacity: fade }]}>
          <MCQCard
            // Key by card identity so internal state (picked choice,
            // answered phase) resets cleanly between cards.
            key={`mcq-${currentCard.user_word_id}-${index}`}
            word={currentCard.word}
            pos={currentCard.pos ?? undefined}
            example={currentCard.example_sentence}
            choices={currentCard.choices}
            level={currentCard.cefr_level}
            // Only set on a definition card, which is what switches the panel
            // from showing the word to asking for it.
            definition={
              currentCard.card_type === 'definition' ? currentCard.definition : null
            }
            onAnswer={(correct) => advance(correct)}
          />
        </Animated.View>
      </SafeAreaView>
    );
  }

  // Unrenderable card — the skip effect above has already queued the skip.
  // Same card outline as every other gap, so nothing on screen moves.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {sharedHeader}
      <QuizCardSkeleton />
    </SafeAreaView>
  );
}

const makeStyles = (tc: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: tc.background },
  primaryBtn: {
    backgroundColor: tc.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: tc.textInverse, fontSize: 16, fontWeight: '700' },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: tc.text, textAlign: 'center' },
  emptyBody: {
    fontSize: 14,
    color: tc.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  bigStat: { fontSize: 56, fontWeight: '700', color: tc.primaryOnSurface },
  streakLine: {
    fontSize: 15,
    fontWeight: '700',
    color: tc.text,
    textAlign: 'center',
  },
  previewHint: { fontSize: 13, color: tc.textFaint, fontStyle: 'italic', textAlign: 'center' },
});

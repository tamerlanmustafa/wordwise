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
import {
  srsApi,
  wordwiseApi,
  SrsPaywallError,
  type ChestPayload,
  type SessionKind,
  type SrsReviewCard,
} from '../services/api';
import { useDailyGoalStore } from '../stores/dailyGoalStore';
import { usePracticePathStore } from '../stores/practicePathStore';
import { useTipDismissalsStore } from '../stores/tipDismissalsStore';
import { useMilestoneTrackerStore } from '../stores/milestoneTrackerStore';
import { useReviewSessionStore } from '../stores/reviewSessionStore';
import { ChestReveal } from './journey/ChestReveal';
import { MilestoneUnlockModal } from './journey/MilestoneUnlockModal';
import { TipPopup } from './common/TipPopup';
import { QuizHeader } from './quiz/QuizHeader';
import { SynonymMCQCard } from './quiz/SynonymMCQCard';
import { TranslationTypeCard } from './quiz/TranslationTypeCard';
import { cefrColors } from '../theme/palette';

// v0.6 spacing-effect tip key — incrementable suffix lets us replace
// the body copy without grandfathering old dismissals (`v2` would
// re-show to users who dismissed v1).
const SPACING_TIP_KEY = 'spacing_first_repeat_v1';

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
  /** v0.7.2 — which Practice tile to start. Omit / pass undefined for
   *  the legacy quick_recall default. */
  kind?: SessionKind;
  /** Required when `kind === 'movie_deep_dive'`. */
  movieId?: number;
  onBack: () => void;
  onPaywall: (previews_used: number, previews_limit: number) => void;
}

// v0.7 §7 — `recall` is gone. The server only ships `synonym_mcq` /
// `type` cards now, both of which own their own internal interaction
// state, so the screen-level phase machine only tracks the high-level
// session lifecycle.
type Phase = 'loading' | 'card' | 'done' | 'empty' | 'error';

export function ReviewScreen({
  kind,
  movieId,
  onBack,
  onPaywall,
}: ReviewScreenProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [cards, setCards] = useState<SrsReviewCard[]>([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState({ got: 0, forgot: 0 });
  const [previewsRemaining, setPreviewsRemaining] = useState<number | null>(null);
  const [isPreview, setIsPreview] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bump info for the streak/wall on the done screen. Populated once when
  // the session finishes; not re-bumped on re-renders.
  const [dailySummary, setDailySummary] = useState<{
    streak: number;
    justHitGoal: boolean;
  } | null>(null);
  // Chest reward returned by /srs/session/complete. `chest` is the
  // payload to render; `chestVisible` controls the overlay so the user
  // can dismiss it without re-firing the API call.
  const [chest, setChest] = useState<ChestPayload | null>(null);
  const [chestVisible, setChestVisible] = useState(false);
  // Spacing-effect tip — shown once per session when the first
  // SRS-resurfaced word appears (srs_box >= 2 means the user has
  // graduated past first-encounter on this word).
  const [spacingTipVisible, setSpacingTipVisible] = useState(false);
  const tipHydrate = useTipDismissalsStore((s) => s.hydrate);
  const tipHydrated = useTipDismissalsStore((s) => s.hydrated);
  useEffect(() => {
    if (!tipHydrated) tipHydrate();
  }, [tipHydrated, tipHydrate]);

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

  const loadSession = useCallback(async () => {
    setPhase('loading');
    setIndex(0);
    setStats({ got: 0, forgot: 0 });

    // v0.7 §7 — try resuming a cached in-flight session for this tile
    // before hitting the server. The cache is scoped by kind+movieId
    // and expires after 24h; if it's not eligible we fall through to a
    // fresh /srs/session/start. We need the store hydrated first so
    // resumable() reads from AsyncStorage, not stale defaults.
    const session_store = useReviewSessionStore.getState();
    if (!session_store.hydrated) {
      await session_store.hydrate();
    }
    const resolvedKind: SessionKind = kind ?? 'quick_recall';
    const resumable = useReviewSessionStore.getState().resumable(resolvedKind, movieId);
    if (resumable) {
      setCards(resumable.remaining);
      setIsPreview(false);
      setPreviewsRemaining(null);
      setStats({ got: resumable.got, forgot: resumable.forgot });
      setPhase('card');
      return;
    }

    try {
      // v0.7.2 — kind + movieId are passed through to the backend so
      // the queue composer matches the Practice-tab tile the user
      // tapped. Undefined kind hits the legacy quick_recall default.
      const session = await srsApi.startSession({ kind, movieId });
      setCards(session.cards);
      setIsPreview(session.is_preview);
      setPreviewsRemaining(session.previews_remaining);
      if (session.cards.length === 0) {
        setPhase('empty');
      } else {
        setPhase('card');
        // Cache the fresh session so a future quit-and-reopen resumes
        // the same deck (within 24h, same kind+movie).
        useReviewSessionStore.getState().start({
          kind: resolvedKind,
          movieId: movieId ?? null,
          remaining: session.cards,
          got: 0,
          forgot: 0,
          totalCards: session.cards.length,
        });
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
  }, [onPaywall, kind, movieId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const currentCard = cards[index];

  // Spacing-effect tip trigger. Fires on the first reappearing card
  // (srs_box >= 2 means the user has gotten this right at least once
  // before — they're seeing it again because of the 3-day Leitner
  // interval that the literature calls out). Guarded by
  // `shouldShow(SPACING_TIP_KEY)` so it never repeats once dismissed
  // or already shown this session.
  // v0.7 §7 — skip any card the client can't render (server shouldn't
  // emit these post-refactor, but old server builds could). We do it
  // in an effect so render stays pure and the skip fires exactly once
  // per card index.
  useEffect(() => {
    if (phase !== 'card' || !currentCard) return;
    const renderable =
      (currentCard.card_type === 'synonym_mcq' && currentCard.choices) ||
      (currentCard.card_type === 'type' && currentCard.translation);
    if (renderable) return;
    console.warn('[ReviewScreen] skipping unrenderable card:', currentCard.card_type, currentCard.word);
    advance(true);
    // We intentionally exclude `advance` from deps to avoid the effect
    // re-running on every advance() call (which mutates state on the
    // next render). Keying off currentCard + phase fires once per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCard, phase]);

  useEffect(() => {
    if (phase !== 'card' || !currentCard || !tipHydrated) return;
    if (currentCard.srs_box < 2) return;
    const { shouldShow, markShown } = useTipDismissalsStore.getState();
    if (!shouldShow(SPACING_TIP_KEY)) return;
    markShown(SPACING_TIP_KEY);
    setSpacingTipVisible(true);
  }, [phase, currentCard, tipHydrated]);

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
      // Pop the answered card from the persistent cache so a quit-and-
      // reopen resumes at the NEXT card. Stats inside the store mirror
      // ours so /srs/session/complete totals stay coherent on resume.
      useReviewSessionStore.getState().consume(correct);

      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();

      if (index + 1 >= cards.length) {
        // Session complete — clear the persistent cache first so a
        // future open of the same tile gets a fresh queue.
        useReviewSessionStore.getState().clear();
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
        // Award the variable-reward chest. Fire and forget — if the
        // network is flaky we still show the done screen; the chest
        // simply won't appear. Server enforces one-per-day so a retry
        // won't double-credit.
        const justCorrect = correct ? stats.got + 1 : stats.got;
        const total = stats.got + stats.forgot + 1;
        srsApi.completeSession(justCorrect, total)
          .then((res) => {
            if (res.chest) {
              setChest(res.chest);
              setChestVisible(true);
            }
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
    [currentCard, index, cards.length, fade, stats]
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
    const streak = dailySummary?.streak ?? 0;
    const justHitGoal = dailySummary?.justHitGoal ?? false;
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Today's done</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.bigStat}>{pct}%</Text>
          <Text style={styles.emptyBody}>
            You remembered {stats.got} of {total} words.
          </Text>
          {streak > 0 && (
            <Text style={styles.streakLine}>
              🔥 {streak}-day streak{justHitGoal ? ' — +1 today!' : ''}
            </Text>
          )}
          {isPreview && previewsRemaining === 0 && (
            <Text style={styles.previewHint}>
              Come back tomorrow — or upgrade for unlimited reviews.
            </Text>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={onBack}>
            <Text style={styles.primaryBtnText}>Back home</Text>
          </TouchableOpacity>
        </View>
        {chestVisible && chest ? (
          <ChestReveal chest={chest} onCollect={() => setChestVisible(false)} />
        ) : null}
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

  // v0.7 §7 — every card is either synonym_mcq or type. The server
  // skips any word that can't build either, so we should never see a
  // recall here. If we do (old server build), drop the card on the
  // floor and advance silently so the queue doesn't black-screen.
  if (!currentCard) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }
  const lvl = (currentCard.cefr_level && currentCard.cefr_level in cefrColors)
    ? (currentCard.cefr_level as keyof typeof cefrColors)
    : null;
  const sharedHeader = (
    <QuizHeader
      movie={currentCard.movie_title ?? 'Daily review'}
      level={lvl}
      index={index + 1}
      total={cards.length}
      onBack={onBack}
    />
  );
  const sharedTip = (
    <TipPopup
      visible={spacingTipVisible}
      eyebrow="Did you know?"
      title="That's the spacing effect at work"
      body={
        'Studies suggest that reviewing a word 3–6 days after first seeing it ' +
        'is when memory really sticks — much better than cramming on one day. ' +
        "You're seeing this word again on that exact rhythm."
      }
      onDismiss={() => setSpacingTipVisible(false)}
      onDontShowAgain={() => {
        void useTipDismissalsStore.getState().dismiss(SPACING_TIP_KEY);
        setSpacingTipVisible(false);
      }}
    />
  );

  if (currentCard.card_type === 'synonym_mcq' && currentCard.choices) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {sharedHeader}
        <Animated.View style={[{ flex: 1 }, { opacity: fade }]}>
          <SynonymMCQCard
            // Key by card identity so internal state (picked choice,
            // answered phase) resets cleanly between cards.
            key={`mcq-${currentCard.user_word_id}-${index}`}
            word={currentCard.word}
            pos={currentCard.pos ?? undefined}
            example={currentCard.example_sentence}
            choices={currentCard.choices}
            onAnswer={(correct) => advance(correct)}
          />
        </Animated.View>
        {sharedTip}
      </SafeAreaView>
    );
  }

  if (currentCard.card_type === 'type' && currentCard.translation) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {sharedHeader}
        <Animated.View style={[{ flex: 1 }, { opacity: fade }]}>
          <TranslationTypeCard
            // Key by card identity so the input value + phase reset
            // cleanly between cards (otherwise the previous answer
            // text persists into the next typing prompt).
            key={`type-${currentCard.user_word_id}-${index}`}
            word={currentCard.word}
            translation={currentCard.translation}
            translationAliases={currentCard.translation_aliases ?? undefined}
            pos={currentCard.pos ?? undefined}
            example={currentCard.example_sentence}
            syllables={currentCard.syllables ?? undefined}
            firstLetter={currentCard.first_letter ?? undefined}
            onAnswer={(correct) => advance(correct)}
          />
        </Animated.View>
        {sharedTip}
      </SafeAreaView>
    );
  }

  // Unrenderable card — the skip effect above has already queued an
  // `advance(true)`. Show the spinner for the brief gap.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {sharedHeader}
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
      {sharedTip}
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
  streakLine: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  previewHint: { fontSize: 13, color: COLORS.textTertiary, fontStyle: 'italic', textAlign: 'center' },
});

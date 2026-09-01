/**
 * feedback — the one place an answer's haptic, sound and motion fire from
 * (issue #162).
 *
 * Duolingo fires all three channels on the same frame for every answer, and
 * the co-firing is the mechanic: any one channel alone is markedly weaker.
 * Every call site gets a single function call (`feedback.correct()`,
 * `feedback.wrong()`, …) so the channels can never drift apart, and the
 * policy — Reduce Motion, the iOS silent switch, platform quirks — lives in
 * one file instead of being re-decided in each component. Scattering
 * `Haptics.impactAsync` through `MCQCard` is how a screen ends up buzzing
 * twice.
 *
 * Only this file and `utils/pronunciation.ts` (word audio, #163) may import
 * `expo-haptics` or `expo-audio` (pinned by `__tests__/feedback.test.ts`).
 * Both read the `AUDIO_MODES` matrix below, so the silent-switch policy is
 * decided once and never in a component.
 *
 * Channels:
 *   haptic — fire-and-forget. Weak and device-dependent on Android, so it is
 *            never the only channel carrying a state change.
 *   sound  — `expo-audio` players created once per session (`preload()`),
 *            not per answer: `createAudioPlayer` on every tap is a 100ms+
 *            hitch landing precisely on the frame that should feel instant.
 *            Written against `expo-audio`, not `expo-av`, which is removed
 *            in SDK 55.
 *   motion — the caller's `Animated` sequence, passed in as a callback so
 *            this module can gate it. Under Reduce Motion the callback is
 *            skipped — the row still turns red or green statically — while
 *            haptics and sound fire unchanged. Reduce Motion is about
 *            vestibular safety, not about wanting less feedback.
 *
 * Audio modes: UI chimes must NOT play when the iOS silent switch is on (a
 * chime in a quiet carriage is how an app gets deleted); pronunciation
 * audio SHOULD. `AUDIO_MODES` holds both, and each playback applies its own
 * right before playing rather than once at startup, because the two share
 * one audio session and whichever played last has configured it.
 */

import { AccessibilityInfo, Animated, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioMode,
  type AudioPlayer,
} from 'expo-audio';

// ---------------------------------------------------------------------------
// Pure policy — no side effects, unit-tested directly.
// ---------------------------------------------------------------------------

export type FeedbackMoment = 'correct' | 'wrong' | 'streak' | 'complete';
export type FeedbackHaptic = 'success' | 'error' | 'impact-medium';
export type FeedbackSound = FeedbackMoment;

export interface FeedbackPlan {
  haptic: FeedbackHaptic;
  sound: FeedbackSound;
  /** Whether the caller's motion may run. False under Reduce Motion. */
  motion: boolean;
}

const HAPTIC_FOR_MOMENT: Record<FeedbackMoment, FeedbackHaptic> = {
  correct: 'success',
  wrong: 'error',
  streak: 'impact-medium',
  complete: 'success',
};

/**
 * What fires for a moment. The haptic and sound never vary; only motion is
 * conditional, and only on Reduce Motion — never on platform, so Android
 * users (weaker haptics) still get every visual.
 */
export function planFeedback(
  moment: FeedbackMoment,
  { reduceMotion }: { reduceMotion: boolean },
): FeedbackPlan {
  return { haptic: HAPTIC_FOR_MOMENT[moment], sound: moment, motion: !reduceMotion };
}

/** A streak moment replaces the plain correct moment every Nth correct in a row. */
export const STREAK_EVERY = 5;

/** `run` is the number of consecutive correct answers INCLUDING this one. */
export function isStreakMilestone(run: number): boolean {
  return run > 0 && run % STREAK_EVERY === 0;
}

export type AudioUse = 'ui' | 'pronunciation';

/**
 * The silent-switch matrix. `ui` is a chime: silenced by the switch, mixed
 * over whatever the user is listening to. `pronunciation` is content the user
 * asked for: plays through the switch and ducks their music while it does.
 * Both explicitly say no recording and no background — the audio session is
 * shared, so each use states its whole intent rather than inheriting the
 * previous caller's.
 */
export const AUDIO_MODES: Record<AudioUse, Partial<AudioMode>> = {
  ui: {
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  },
  pronunciation: {
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  },
};

// ---------------------------------------------------------------------------
// Motion builders — `transform`/`opacity` only, so every one of these runs
// with `useNativeDriver: true` (SMOOTHNESS_AND_DESIGN_PLAYBOOK §8).
// ---------------------------------------------------------------------------

/** Correct row: scale 1 → 1.04 → 1 over 120ms. */
export const PULSE_SCALE = 1.04;
export const PULSE_MS = 120;
/** Wrong: the card shakes ±6pt, three times, ~60ms per oscillation. */
export const SHAKE_PX = 6;
export const SHAKE_LEG_MS = 30;
/** Streak: a gold band sweeps across the header. */
export const SWEEP_MS = 600;

export function pulse(scale: Animated.Value): Animated.CompositeAnimation {
  const half = PULSE_MS / 2;
  return Animated.sequence([
    Animated.timing(scale, { toValue: PULSE_SCALE, duration: half, useNativeDriver: true }),
    Animated.timing(scale, { toValue: 1, duration: half, useNativeDriver: true }),
  ]);
}

export function shake(translateX: Animated.Value): Animated.CompositeAnimation {
  const legs = [SHAKE_PX, -SHAKE_PX, SHAKE_PX, -SHAKE_PX, SHAKE_PX, -SHAKE_PX, 0];
  return Animated.sequence(
    legs.map((toValue) =>
      Animated.timing(translateX, { toValue, duration: SHAKE_LEG_MS, useNativeDriver: true }),
    ),
  );
}

/** Drives a 0 → 1 progress the header interpolates into position + opacity. */
export function sweep(progress: Animated.Value): Animated.CompositeAnimation {
  progress.setValue(0);
  return Animated.timing(progress, {
    toValue: 1,
    duration: SWEEP_MS,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  });
}

// ---------------------------------------------------------------------------
// Side effects.
// ---------------------------------------------------------------------------

const SOUND_SOURCES: Record<FeedbackSound, number> = {
  correct: require('../../assets/sounds/correct.wav'),
  wrong: require('../../assets/sounds/wrong.wav'),
  streak: require('../../assets/sounds/streak.wav'),
  complete: require('../../assets/sounds/complete.wav'),
};
const SOUND_KEYS = Object.keys(SOUND_SOURCES) as FeedbackSound[];

let players: Partial<Record<FeedbackSound, AudioPlayer>> | null = null;
let reduceMotion = false;
let reduceMotionSub: { remove: () => void } | null = null;

function ensurePlayers(): Partial<Record<FeedbackSound, AudioPlayer>> {
  if (players) return players;
  const next: Partial<Record<FeedbackSound, AudioPlayer>> = {};
  for (const key of SOUND_KEYS) {
    try {
      next[key] = createAudioPlayer(SOUND_SOURCES[key]);
    } catch {
      // No audio backend (web without a user gesture, a stripped build) —
      // the haptic and motion channels still carry the answer.
    }
  }
  players = next;
  return next;
}

/**
 * Call once when a session screen mounts. Creates the four players so the
 * first answer doesn't pay for loading, and reads Reduce Motion so firing
 * never has to await it. Idempotent — a second call is a no-op apart from
 * refreshing the Reduce Motion flag.
 */
export async function preload(): Promise<void> {
  ensurePlayers();
  if (!reduceMotionSub) {
    reduceMotionSub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotion = v;
    });
  }
  try {
    reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
  } catch {
    reduceMotion = false;
  }
}

/** Call when the session screen unmounts. Safe without a prior `preload`. */
export function release(): void {
  if (players) {
    for (const key of SOUND_KEYS) {
      try {
        players[key]?.remove();
      } catch {
        // Already released by the runtime.
      }
    }
    players = null;
  }
  reduceMotionSub?.remove();
  reduceMotionSub = null;
}

function fireHaptic(kind: FeedbackHaptic): void {
  try {
    const call =
      kind === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'error'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    call.catch(() => {});
  } catch {
    // No haptic engine (web, simulator) — never let it break the answer.
  }
}

async function playSound(kind: FeedbackSound): Promise<void> {
  const player = ensurePlayers()[kind];
  if (!player) return;
  try {
    // Per playback, not per session: a pronunciation tap in between has
    // reconfigured the shared session to play through the silent switch.
    await setAudioModeAsync(AUDIO_MODES.ui);
    // expo-audio does not rewind on finish, so a replayed chime would be
    // silent without this. Not awaited — the documented replay idiom is
    // seek-then-play in one tick.
    player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Silent failure is the correct failure for a chime.
  }
}

export interface FireOptions {
  /** The caller's motion — `Animated` sequences on values it owns. Skipped
   *  under Reduce Motion; haptic and sound still fire. */
  motion?: () => void;
}

function fire(moment: FeedbackMoment, opts?: FireOptions): void {
  const plan = planFeedback(moment, { reduceMotion });
  // Order is the latency order: the haptic is the fastest channel, the
  // motion is a native-driver dispatch, the sound awaits one audio-mode hop.
  fireHaptic(plan.haptic);
  if (plan.motion) opts?.motion?.();
  playSound(plan.sound).catch(() => {});
}

export const feedback = {
  preload,
  release,
  /** Right answer: Success haptic, rising two-note, the row pulses. */
  correct: (opts?: FireOptions) => fire('correct', opts),
  /** Wrong answer: Error haptic, soft descending thud, the card shakes. */
  wrong: (opts?: FireOptions) => fire('wrong', opts),
  /** Every `STREAK_EVERY`th correct in a row — replaces `correct`, never stacks on it. */
  streak: (opts?: FireOptions) => fire('streak', opts),
  /** Session complete: Success haptic, resolving chord. Confetti is the
   *  host's (`ui/Confetti.tsx`, already Reduce-Motion aware). */
  complete: (opts?: FireOptions) => fire('complete', opts),
};

/** Test-only: the module's current Reduce Motion reading. */
export function __reduceMotionForTests(): boolean {
  return reduceMotion;
}

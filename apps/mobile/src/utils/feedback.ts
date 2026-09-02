/**
 * feedback — the one place a moment's sound and haptic fire from (issue #179).
 *
 * Three moments, deliberately few: a right answer, a wrong answer, and the tap
 * on a button. Every call site gets a single function (`feedback.correct()`),
 * so the two channels can never drift apart and the policy — the user's two
 * switches, the silent switch, missing hardware — is decided here instead of
 * being re-decided in each component. Scattering `Haptics.impactAsync` through
 * the quiz is how a screen ends up buzzing twice for one answer.
 *
 * Sound uses `expo-av`, which the app already ships, rather than `expo-audio`.
 * That is a deliberate reversal of the reverted #162/#163 pair: `expo-audio`
 * declares `expo-asset: *`, which resolved to the SDK 55 build and removed the
 * ExpoAsset pod from the iOS project. `expo-av` is removed in SDK 55 and this
 * file will have to move then, but taking that migration today would mean
 * re-entering a known-bad dependency graph for no user-visible gain.
 *
 * Players are created once and replayed, never created per answer:
 * `createAsync` costs 100ms+ and would land precisely on the frame that is
 * supposed to feel instant.
 *
 * Every channel fails silently and independently. Feedback is a garnish on an
 * interaction that has already happened — an answer must never fail to be
 * recorded because a device has no haptic engine.
 */

import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { applyAudioMode } from './audioModes';
import { getFeedbackPrefs } from '../stores/feedbackPrefsStore';

// ---------------------------------------------------------------------------
// Pure policy — no side effects, unit-tested directly.
// ---------------------------------------------------------------------------

export type FeedbackMoment = 'correct' | 'wrong' | 'tap';
export type FeedbackHaptic = 'success' | 'error' | 'light';
export type FeedbackSound = 'correct' | 'wrong';

export interface FeedbackPlan {
  haptic: FeedbackHaptic | null;
  sound: FeedbackSound | null;
}

const HAPTIC_FOR_MOMENT: Record<FeedbackMoment, FeedbackHaptic> = {
  correct: 'success',
  wrong: 'error',
  tap: 'light',
};

const SOUND_FOR_MOMENT: Record<FeedbackMoment, FeedbackSound | null> = {
  correct: 'correct',
  wrong: 'wrong',
  // A tap is haptic-only. A chime on every button press is the fastest way to
  // make a user turn sound off entirely, which would cost the answer chimes
  // that actually carry meaning.
  tap: null,
};

/**
 * What may fire for a moment, given the user's two switches. Each channel is
 * gated by its own preference — turning sound off must not silence haptics.
 */
export function planFeedback(
  moment: FeedbackMoment,
  prefs: { soundEnabled: boolean; hapticsEnabled: boolean },
): FeedbackPlan {
  return {
    haptic: prefs.hapticsEnabled ? HAPTIC_FOR_MOMENT[moment] : null,
    sound: prefs.soundEnabled ? SOUND_FOR_MOMENT[moment] : null,
  };
}

// ---------------------------------------------------------------------------
// Side effects.
// ---------------------------------------------------------------------------

const SOUND_SOURCES: Record<FeedbackSound, number> = {
  correct: require('../../assets/sounds/correct.wav'),
  wrong: require('../../assets/sounds/wrong.wav'),
};
const SOUND_KEYS = Object.keys(SOUND_SOURCES) as FeedbackSound[];

let players: Partial<Record<FeedbackSound, Audio.Sound>> | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the chimes. Call when a session screen mounts so the first answer does
 * not pay for the load. Idempotent, and concurrent calls share one load.
 */
export function preload(): Promise<void> {
  if (players) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    const next: Partial<Record<FeedbackSound, Audio.Sound>> = {};
    for (const key of SOUND_KEYS) {
      try {
        const { sound } = await Audio.Sound.createAsync(SOUND_SOURCES[key], {
          shouldPlay: false,
        });
        next[key] = sound;
      } catch {
        // No audio backend, or a device that refused the file. The haptic
        // channel still carries the answer.
      }
    }
    players = next;
    loading = null;
  })();

  return loading;
}

/**
 * Call when a session screen unmounts. Safe without a prior preload.
 *
 * Awaits an in-flight load first: a screen that unmounts while `preload` is
 * still resolving would otherwise release nothing, and the load would then
 * publish its players into a module nobody is going to unload them from.
 *
 * If two session screens are ever mounted at once, the first unmount releases
 * for both — harmless, because `playSound` reloads on demand.
 */
export async function release(): Promise<void> {
  if (loading) {
    try {
      await loading;
    } catch {
      // A failed load has nothing to release.
    }
  }
  const current = players;
  players = null;
  if (!current) return;
  for (const key of SOUND_KEYS) {
    try {
      await current[key]?.unloadAsync();
    } catch {
      // Already released by the runtime.
    }
  }
}

function fireHaptic(kind: FeedbackHaptic): void {
  try {
    const call =
      kind === 'success'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : kind === 'error'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void call.catch(() => {});
  } catch {
    // No haptic engine (simulator, most cheap Android hardware).
  }
}

async function playSound(kind: FeedbackSound): Promise<void> {
  if (!players) await preload();
  const player = players?.[kind];
  if (!player) return;
  try {
    // Per playback, not per session: a pronunciation tap in between has
    // reconfigured the shared audio session to play through the silent switch.
    await applyAudioMode('ui');
    // replayAsync rewinds and plays in one call — a second correct answer
    // would otherwise be silent, the sound still sitting at its end position.
    await player.replayAsync();
  } catch {
    // A chime that fails to play is not worth surfacing.
  }
}

function fire(moment: FeedbackMoment): void {
  const plan = planFeedback(moment, getFeedbackPrefs());
  // Haptic first: it is the lower-latency channel, and the sound costs one
  // audio-session hop before it can start.
  if (plan.haptic) fireHaptic(plan.haptic);
  if (plan.sound) void playSound(plan.sound).catch(() => {});
}

export const feedback = {
  preload,
  release,
  /** A right answer: Success haptic + rising chime. */
  correct: () => fire('correct'),
  /** A wrong answer: Error haptic + soft descending chime. */
  wrong: () => fire('wrong'),
  /** A button press. Haptic only — see SOUND_FOR_MOMENT. */
  tap: () => fire('tap'),
};

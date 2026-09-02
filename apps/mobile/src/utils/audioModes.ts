/**
 * audioModes — the silent-switch policy, decided once (issue #178).
 *
 * iOS and Android give an app a single shared audio session, so whichever
 * sound played last has configured it for the next one. That makes the mode a
 * property of the *playback*, not of app startup: every player in the app
 * applies its own mode immediately before playing, and this file is the only
 * place the two intents are written down.
 *
 * The two intents differ on exactly one question — should the hardware mute
 * switch silence this?
 *
 *   ui            A chime the app decided to play. The user did not ask for
 *                 it, so a muted phone must stay silent; a chime in a quiet
 *                 carriage is how an app gets deleted. Mixes over whatever
 *                 they are already listening to.
 *   pronunciation Audio the user explicitly tapped a speaker to hear. It is
 *                 the content, so it plays through the mute switch and ducks
 *                 their music while it does — the same call Podcasts and
 *                 Google Translate make.
 *
 * Written against `expo-av`, which is what the app ships. `expo-av` is removed
 * in SDK 55 and the migration to `expo-audio` (closed issue #163) will have to
 * translate these two objects — the *policy* survives that move, which is why
 * it lives apart from any one player.
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';

export type AudioUse = 'ui' | 'pronunciation';

/**
 * Every field is stated explicitly rather than left to default. The session is
 * shared, so a partial mode inherits the previous caller's answer to the
 * question it didn't ask — which is how a chime ends up playing on a silenced
 * phone after a pronunciation tap.
 */
export const AUDIO_MODES: Record<AudioUse, Parameters<typeof Audio.setAudioModeAsync>[0]> = {
  ui: {
    playsInSilentModeIOS: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    // Android has no MixWithOthers; ducking is the closest non-interrupting
    // option, and a 300ms chime barely registers as a duck.
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    playThroughEarpieceAndroid: false,
  },
  pronunciation: {
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DuckOthers,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    allowsRecordingIOS: false,
    staysActiveInBackground: false,
    playThroughEarpieceAndroid: false,
  },
};

/**
 * Applies a use's mode. Never rejects: failing to configure the session is not
 * a reason to refuse to play, and on a device that dislikes one of these flags
 * the sound still comes out — just under whatever mode was already set.
 */
export async function applyAudioMode(use: AudioUse): Promise<void> {
  try {
    await Audio.setAudioModeAsync(AUDIO_MODES[use]);
  } catch {
    // Session already in a compatible state, or a platform that rejects a
    // flag combination. Play anyway.
  }
}

/**
 * pronunciation — plays a word's TTS clip from the premium endpoint (#178).
 *
 * Why this file exists: `GET /premium/pronounce/{word}` is bearer-gated
 * (`Depends(get_current_active_user)`), and both call sites used to hand the
 * player a bare `{ uri }` with no headers. Every tap 401'd, and the `catch`
 * around it swallowed the failure — so the speaker has never played anything
 * in production, on either platform, since the endpoint shipped. The fix is
 * one line of substance (send the token) and one decision (where the token
 * comes from), but it was duplicated across two components, which is how it
 * stayed broken in both.
 *
 * `expo-av` forwards a source's `headers` to the underlying request on both
 * platforms (`AVURLAssetHTTPHeaderFieldsKey` on iOS, ExoPlayer request
 * properties on Android), so the audio can be streamed authenticated rather
 * than downloaded to a file first.
 *
 * A player per tap, created and unloaded, is deliberate: the deck's word
 * changes on every swipe and a row's tap is the whole interaction, so there is
 * no source stable enough to hold a player against.
 *
 * Failure handling is the other half of the bug. `expo-av` rejects
 * `createAsync` when the load fails (the 401 path), but a stalled network can
 * leave a sound that neither finishes nor errors, so every playback is bounded
 * by a watchdog — the speaker icon can never stick on "…".
 */

import { Audio, type AVPlaybackStatus } from 'expo-av';
import { applyAudioMode } from './audioModes';
import { premiumApi } from '../services/api';
import { tokenStorage } from '../services/auth/tokenStorage';

// ---------------------------------------------------------------------------
// Pure — unit-tested directly.
// ---------------------------------------------------------------------------

/** A word's clip is a second or two. This is a safety net, not a budget. */
export const PRONOUNCE_TIMEOUT_MS = 15_000;

export type PlaybackOutcome = 'finished' | 'failed';

/**
 * Whether a status update ends the playback.
 *
 * The unloaded case is the subtle one: `isLoaded: false` arrives both when a
 * sound fails to load *and* as the normal last event after `unloadAsync`, so
 * only the presence of `error` distinguishes them. Reading every unloaded
 * status as a failure would report a failure for every successful playback.
 */
export function playbackOutcome(status: AVPlaybackStatus): PlaybackOutcome | null {
  if (!status.isLoaded) return status.error ? 'failed' : null;
  if (status.didJustFinish) return 'finished';
  return null;
}

export interface PronunciationSource {
  uri: string;
  headers?: Record<string, string>;
}

/**
 * The remote source for a word: the premium URL plus the bearer token when the
 * user has one. Without a token the request goes bare and the server refuses
 * it — the speaker is premium-gated in the UI, so that is the logged-out edge
 * rather than the normal path.
 */
export async function pronunciationSource(word: string): Promise<PronunciationSource> {
  const uri = premiumApi.pronounceUrl(word);
  const token = await tokenStorage.getAccessToken();
  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}

// ---------------------------------------------------------------------------
// Side effects.
// ---------------------------------------------------------------------------

/** The playback in flight, if any. One word at a time: a new tap cancels it. */
let active: { settle: (result: PronounceResult) => void } | null = null;
/** Bumped per tap, so a tap superseded while still reading its token never starts. */
let generation = 0;

/** Test seam: #179 replaces this so the Sound switch can mute pronunciation. */
let soundAllowed: () => boolean = () => true;
export function setPronunciationGate(gate: () => boolean): void {
  soundAllowed = gate;
}

/**
 * Why three results and not a boolean: a playback that a newer tap cancelled
 * has not failed, and a caller that cannot tell the two apart shows an error
 * toast every time the user taps a second word before the first finishes.
 * `muted` is the same argument for the Sound switch (#179) — deliberately off
 * is not broken.
 */
export type PronounceResult = 'played' | 'failed' | 'superseded' | 'muted';

/**
 * Plays `word`. Never rejects: the caller only needs to know when to put the
 * speaker icon back, and it should not have to wrap the call in its own
 * try/catch to find out.
 */
export async function pronounce(word: string): Promise<PronounceResult> {
  if (!soundAllowed()) return 'muted';

  const gen = ++generation;
  active?.settle('superseded');

  const source = await pronunciationSource(word);
  if (gen !== generation) return 'superseded';

  await applyAudioMode('pronunciation');
  if (gen !== generation) return 'superseded';

  let sound: Audio.Sound;
  try {
    // `shouldPlay` starts it as soon as it is loaded; a 401 rejects here.
    ({ sound } = await Audio.Sound.createAsync(source, { shouldPlay: true }));
  } catch {
    return 'failed';
  }
  if (gen !== generation) {
    void sound.unloadAsync().catch(() => {});
    return 'superseded';
  }

  return new Promise<PronounceResult>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (result: PronounceResult): void => {
      if (done) return;
      done = true;
      if (active?.settle === settle) active = null;
      if (timer) clearTimeout(timer);
      try {
        sound.setOnPlaybackStatusUpdate(null);
      } catch {
        // Player already released by the runtime.
      }
      void sound.unloadAsync().catch(() => {});
      resolve(result);
    };
    active = { settle };

    sound.setOnPlaybackStatusUpdate((status) => {
      const outcome = playbackOutcome(status);
      if (outcome) settle(outcome === 'finished' ? 'played' : 'failed');
    });
    // A stalled network can leave a sound that neither finishes nor errors.
    timer = setTimeout(() => settle('failed'), PRONOUNCE_TIMEOUT_MS);
  });
}

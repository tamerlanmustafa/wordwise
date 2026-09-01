/**
 * pronunciation — plays a word's TTS pronunciation from the premium endpoint
 * (issue #163: the last two `expo-av` call sites, moved onto `expo-audio`
 * before SDK 55 removes `expo-av`).
 *
 * Together with `utils/feedback.ts` this is the only file allowed to import
 * `expo-audio` (pinned by `__tests__/feedback.test.ts`), so the silent-switch
 * policy is decided in one place: pronunciation is content the user asked
 * for, so it plays through the iOS silent switch and ducks their music
 * (`AUDIO_MODES.pronunciation`). The mode is applied per playback, right
 * before `play()`, and never at startup — the quiz chimes share the audio
 * session and want the opposite setting.
 *
 * Why the bearer token: `/premium/pronounce/{word}` is gated by
 * `OAuth2PasswordBearer`, header only. The `expo-av` version sent a bare
 * `{ uri }` and 401'd every tap (prod, 2026-09-01), so the button had never
 * played anything. Both native players forward `headers` to the request
 * (`AVURLAssetHTTPHeaderFieldsKey` / ExoPlayer request properties).
 *
 * Why not the hook API: `useAudioPlayer` binds one source to a component's
 * lifetime. The deck's word changes on every swipe and the row's tap is the
 * whole interaction, so a player per tap — created, played, removed when it
 * finishes — is the honest shape, and it is what the old code did.
 *
 * Failure: iOS reports a load failure as `playbackState: 'failed'`; Android
 * only drops back to `'idle'`, which is also the state before preparing, so
 * it cannot be read as an error. A watchdog therefore bounds every playback:
 * the speaker never sticks on "…" and a dead player never leaks for longer
 * than `PRONOUNCE_TIMEOUT_MS`.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { AUDIO_MODES } from './feedback';
import { premiumApi } from '../services/api';
import { tokenStorage } from '../services/auth/tokenStorage';

// ---------------------------------------------------------------------------
// Pure — unit-tested directly.
// ---------------------------------------------------------------------------

/** A single word's TTS clip is a second or two; this is a safety net, not a budget. */
export const PRONOUNCE_TIMEOUT_MS = 15_000;

export type PlaybackOutcome = 'finished' | 'failed';

/**
 * Whether a status update ends the playback. `didJustFinish` is the normal
 * end on both platforms; `'failed'` is iOS's load error. Anything else
 * (buffering, ready, idle, playing) keeps waiting.
 */
export function playbackOutcome(
  status: Pick<AudioStatus, 'didJustFinish' | 'playbackState'>,
): PlaybackOutcome | null {
  if (status.didJustFinish) return 'finished';
  if (status.playbackState === 'failed') return 'failed';
  return null;
}

export interface PronunciationSource {
  uri: string;
  headers?: Record<string, string>;
}

/**
 * The remote source for a word: the premium URL plus the bearer token when
 * the user has one. Without a token the request is sent bare and the server
 * refuses it — the speaker button is premium-gated, so that is the logged-out
 * edge, not the normal path.
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
let active: { settle: (ok: boolean) => void } | null = null;
/** Bumped per tap so a tap superseded while still fetching its token never starts. */
let generation = 0;

/**
 * Plays `word` and resolves when the clip finishes — `true` — or when it
 * fails, is cancelled by a newer tap, or hits the watchdog — `false`. Never
 * rejects: a failed pronunciation is a silent failure, and the caller only
 * needs to know when to put the speaker icon back.
 */
export async function pronounce(word: string): Promise<boolean> {
  const gen = ++generation;
  active?.settle(false);

  const source = await pronunciationSource(word);
  if (gen !== generation) return false;

  let player: AudioPlayer;
  try {
    player = createAudioPlayer(source);
  } catch {
    // No audio backend (web without a gesture, a stripped build).
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let done = false;
    let sub: { remove: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (ok: boolean): void => {
      if (done) return;
      done = true;
      if (active?.settle === settle) active = null;
      if (timer) clearTimeout(timer);
      try {
        sub?.remove();
      } catch {
        // Listener already gone with the player.
      }
      try {
        player.pause();
        player.remove();
      } catch {
        // Already released by the runtime.
      }
      resolve(ok);
    };
    active = { settle };

    try {
      sub = player.addListener('playbackStatusUpdate', (status) => {
        const outcome = playbackOutcome(status);
        if (outcome) settle(outcome === 'finished');
      });
    } catch {
      // Without status events the watchdog is the only end; still play.
    }
    timer = setTimeout(() => settle(false), PRONOUNCE_TIMEOUT_MS);

    // Per playback, not per session: a quiz chime in between has configured
    // the shared session to respect the silent switch.
    setAudioModeAsync(AUDIO_MODES.pronunciation)
      .catch(() => {})
      .then(() => {
        if (!done) player.play();
      })
      .catch(() => settle(false));
  });
}

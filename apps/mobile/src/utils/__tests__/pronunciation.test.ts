/**
 * utils/pronunciation (#178) — logic + integration, per CLAUDE.md: the pure
 * outcome rule, the bearer-token source that was the whole bug, and the
 * player lifecycle driven through the expo-av mock in jest.setup.js
 * (`__sounds` records what was created, `sound.__emit` delivers a status).
 */

import * as SecureStore from 'expo-secure-store';
import * as ExpoAv from 'expo-av';
import type { AVPlaybackStatus } from 'expo-av';
import { tokenStorage } from '../../services/auth/tokenStorage';
import {
  PRONOUNCE_TIMEOUT_MS,
  playbackOutcome,
  pronounce,
  pronunciationSource,
  setPronunciationGate,
} from '../pronunciation';

type MockSound = {
  source: { uri?: string; headers?: Record<string, string> };
  unloadAsync: jest.Mock;
  setOnPlaybackStatusUpdate: jest.Mock;
  __emit: (status: Partial<AVPlaybackStatus>) => void;
};
const avMock = ExpoAv as unknown as {
  __sounds: MockSound[];
  __reset: () => void;
  __failNextLoad: () => void;
};
const secureMock = SecureStore as unknown as { __reset: () => void };
const setAudioModeAsync = jest.mocked(ExpoAv.Audio.setAudioModeAsync);

/** Every await in `pronounce` is a mocked async fn, so microtasks are enough —
 *  and unlike setImmediate this also works under fake timers. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const lastSound = () => avMock.__sounds[avMock.__sounds.length - 1];

beforeEach(async () => {
  avMock.__reset();
  secureMock.__reset();
  jest.clearAllMocks();
  setPronunciationGate(() => true);
  await tokenStorage.saveTokens('access-1', 'refresh-1');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('playbackOutcome — what ends a playback', () => {
  const loaded = (over: Partial<AVPlaybackStatus>) =>
    ({ isLoaded: true, didJustFinish: false, ...over }) as AVPlaybackStatus;

  it('didJustFinish is the normal end', () => {
    expect(playbackOutcome(loaded({ didJustFinish: true }))).toBe('finished');
  });

  it('keeps waiting while the clip is still playing', () => {
    expect(playbackOutcome(loaded({}))).toBeNull();
  });

  it('an unloaded status carrying an error is a failure', () => {
    expect(playbackOutcome({ isLoaded: false, error: 'boom' } as AVPlaybackStatus)).toBe('failed');
  });

  it('an unloaded status with no error is NOT a failure — it is the normal last event after unload', () => {
    expect(playbackOutcome({ isLoaded: false } as AVPlaybackStatus)).toBeNull();
  });
});

describe('pronunciationSource — the 401 this ticket fixes', () => {
  it('sends the access token as a bearer header', async () => {
    const source = await pronunciationSource('ephemeral');
    expect(source.headers).toEqual({ Authorization: 'Bearer access-1' });
  });

  it('points at the premium endpoint and url-encodes the word', async () => {
    const source = await pronunciationSource('sotto voce');
    expect(source.uri).toContain('/premium/pronounce/sotto%20voce');
  });

  it('omits the header entirely when there is no token, rather than sending "Bearer null"', async () => {
    await tokenStorage.clearTokens();
    const source = await pronunciationSource('ephemeral');
    expect(source.headers).toBeUndefined();
  });
});

describe('pronounce — playback lifecycle', () => {
  it('plays the authenticated source and resolves when the clip finishes', async () => {
    const promise = pronounce('ephemeral');
    await flush();

    const sound = lastSound();
    expect(sound.source.headers).toEqual({ Authorization: 'Bearer access-1' });

    sound.__emit({ didJustFinish: true });
    await expect(promise).resolves.toBe('played');
    expect(sound.unloadAsync).toHaveBeenCalled();
  });

  it('applies the pronunciation audio mode — plays through the iOS silent switch', async () => {
    const promise = pronounce('ephemeral');
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ playsInSilentModeIOS: true }),
    );
    lastSound().__emit({ didJustFinish: true });
    await promise;
  });

  it('resolves "failed" when the load rejects — the 401 path', async () => {
    avMock.__failNextLoad();
    await expect(pronounce('ephemeral')).resolves.toBe('failed');
  });

  it('resolves "failed" on a playback error so the caller can surface it', async () => {
    const promise = pronounce('ephemeral');
    await flush();
    lastSound().__emit({ isLoaded: false, error: 'network' } as Partial<AVPlaybackStatus>);
    await expect(promise).resolves.toBe('failed');
  });

  it('a second tap supersedes the first — not a failure, so no error toast', async () => {
    const first = pronounce('ephemeral');
    await flush();
    const second = pronounce('liminal');
    await flush();

    await expect(first).resolves.toBe('superseded');
    expect(avMock.__sounds[0].unloadAsync).toHaveBeenCalled();

    lastSound().__emit({ didJustFinish: true });
    await expect(second).resolves.toBe('played');
  });

  it('the watchdog settles a playback that never finishes, so the icon cannot stick', async () => {
    jest.useFakeTimers();
    const promise = pronounce('ephemeral');
    await flush();

    jest.advanceTimersByTime(PRONOUNCE_TIMEOUT_MS);
    await expect(promise).resolves.toBe('failed');
    expect(lastSound().unloadAsync).toHaveBeenCalled();
  });

  it('is muted — not failed — when the sound preference gate says no (#179)', async () => {
    setPronunciationGate(() => false);
    await expect(pronounce('ephemeral')).resolves.toBe('muted');
    expect(avMock.__sounds).toHaveLength(0);
  });
});

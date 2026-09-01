/**
 * utils/pronunciation — the expo-audio pronunciation player (issue #163).
 * Logic-only per CLAUDE.md: the pure outcome rule, the bearer-token source,
 * and the player lifecycle driven through the expo-audio mock in
 * jest.setup.js (`__emit` delivers a status update to a player's listeners).
 */

import * as SecureStore from 'expo-secure-store';
import * as ExpoAudio from 'expo-audio';
import { tokenStorage } from '../../services/auth/tokenStorage';
import { premiumApi } from '../../services/api';
import { AUDIO_MODES } from '../feedback';
import {
  PRONOUNCE_TIMEOUT_MS,
  playbackOutcome,
  pronounce,
  pronunciationSource,
} from '../pronunciation';

type MockPlayer = {
  source: { uri?: string; headers?: Record<string, string> };
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  addListener: jest.Mock;
  __emit: (event: string, payload: unknown) => void;
  __listenerCount: () => number;
};
const audioMock = ExpoAudio as unknown as { __players: MockPlayer[]; __reset: () => void };
const secureMock = SecureStore as unknown as { __reset: () => void };
const createAudioPlayer = jest.mocked(ExpoAudio.createAudioPlayer);
const setAudioModeAsync = jest.mocked(ExpoAudio.setAudioModeAsync);

/** Every await in `pronounce` is a mocked async fn, so microtasks are enough —
 *  and unlike setImmediate this also works under fake timers. */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const lastPlayer = () => audioMock.__players[audioMock.__players.length - 1];
const status = (over: Partial<ExpoAudio.AudioStatus>): ExpoAudio.AudioStatus =>
  ({ didJustFinish: false, playbackState: 'readyToPlay', ...over }) as ExpoAudio.AudioStatus;

beforeEach(async () => {
  audioMock.__reset();
  secureMock.__reset();
  jest.clearAllMocks();
  await tokenStorage.saveTokens('access-1', 'refresh-1');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('playbackOutcome — what ends a playback', () => {
  it('didJustFinish is the normal end on both platforms', () => {
    expect(playbackOutcome(status({ didJustFinish: true }))).toBe('finished');
  });

  it("iOS's 'failed' load state is a failure", () => {
    expect(playbackOutcome(status({ playbackState: 'failed' }))).toBe('failed');
  });

  it.each(['idle', 'buffering', 'ready', 'readyToPlay', 'unknown'])(
    "'%s' keeps waiting — Android's idle is also the pre-prepare state",
    (playbackState) => {
      expect(playbackOutcome(status({ playbackState }))).toBeNull();
    },
  );
});

describe('pronunciationSource — the premium URL with the bearer token', () => {
  it('attaches the stored access token as an Authorization header', async () => {
    await expect(pronunciationSource('hello world')).resolves.toEqual({
      uri: premiumApi.pronounceUrl('hello world'),
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('sends a bare source when there is no token', async () => {
    secureMock.__reset();
    const source = await pronunciationSource('hello');
    expect(source).toEqual({ uri: premiumApi.pronounceUrl('hello') });
    expect(source).not.toHaveProperty('headers');
  });
});

describe('pronounce — one player per tap', () => {
  it('creates the player from the authenticated source and applies the pronunciation mode before play()', async () => {
    const done = pronounce('hello');
    await flush();

    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer.mock.calls[0][0]).toEqual({
      uri: premiumApi.pronounceUrl('hello'),
      headers: { Authorization: 'Bearer access-1' },
    });
    const player = lastPlayer();
    expect(player.play).toHaveBeenCalledTimes(1);

    // The matrix's pronunciation row — through the silent switch — and it is
    // applied on this playback, not assumed from startup.
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(AUDIO_MODES.pronunciation);
    const modeOrder = setAudioModeAsync.mock.invocationCallOrder.slice(-1)[0];
    expect(modeOrder).toBeLessThan(player.play.mock.invocationCallOrder[0]);

    player.__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(done).resolves.toBe(true);
  });

  it('resolves true when the clip finishes, then releases the player and its listener', async () => {
    const done = pronounce('hello');
    await flush();
    const player = lastPlayer();
    expect(player.__listenerCount()).toBe(1);

    player.__emit('playbackStatusUpdate', status({ isBuffering: true }));
    player.__emit('playbackStatusUpdate', status({ playing: true }));
    player.__emit('playbackStatusUpdate', status({ didJustFinish: true }));

    await expect(done).resolves.toBe(true);
    expect(player.remove).toHaveBeenCalledTimes(1);
    expect(player.__listenerCount()).toBe(0);
  });

  it("resolves false on iOS's 'failed' state and still releases the player", async () => {
    const done = pronounce('hello');
    await flush();
    const player = lastPlayer();

    player.__emit('playbackStatusUpdate', status({ playbackState: 'failed' }));

    await expect(done).resolves.toBe(false);
    expect(player.remove).toHaveBeenCalledTimes(1);
  });

  it('the watchdog ends a playback that never reports — the speaker never sticks on "…"', async () => {
    jest.useFakeTimers();
    const done = pronounce('hello');
    await flush();
    const player = lastPlayer();
    expect(player.play).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PRONOUNCE_TIMEOUT_MS - 1);
    await flush();
    expect(player.remove).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await expect(done).resolves.toBe(false);
    expect(player.remove).toHaveBeenCalledTimes(1);
  });

  it('a finished playback disarms its watchdog — a later timer does not touch the next player', async () => {
    jest.useFakeTimers();
    const first = pronounce('one');
    await flush();
    const p1 = lastPlayer();
    p1.__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(first).resolves.toBe(true);

    const second = pronounce('two');
    await flush();
    const p2 = lastPlayer();
    jest.advanceTimersByTime(PRONOUNCE_TIMEOUT_MS - 1);
    await flush();
    expect(p2.remove).not.toHaveBeenCalled();
    expect(p1.remove).toHaveBeenCalledTimes(1);

    p2.__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(second).resolves.toBe(true);
  });

  it('a second tap cancels the first: the first resolves false and its player is paused and removed', async () => {
    const first = pronounce('one');
    await flush();
    const p1 = lastPlayer();

    const second = pronounce('two');
    await flush();
    const p2 = lastPlayer();

    await expect(first).resolves.toBe(false);
    expect(p1.pause).toHaveBeenCalledTimes(1);
    expect(p1.remove).toHaveBeenCalledTimes(1);
    expect(p2).not.toBe(p1);
    expect(p2.remove).not.toHaveBeenCalled();

    p2.__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(second).resolves.toBe(true);
  });

  it('a tap superseded while still fetching its token never creates a player', async () => {
    const first = pronounce('one');
    const second = pronounce('two');
    await flush();

    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer.mock.calls[0][0]).toMatchObject({ uri: premiumApi.pronounceUrl('two') });
    await expect(first).resolves.toBe(false);

    lastPlayer().__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(second).resolves.toBe(true);
  });

  it('a status update after the end is ignored — no double release', async () => {
    const done = pronounce('hello');
    await flush();
    const player = lastPlayer();
    player.__emit('playbackStatusUpdate', status({ didJustFinish: true }));
    await expect(done).resolves.toBe(true);

    expect(() => player.__emit('playbackStatusUpdate', status({ didJustFinish: true }))).not.toThrow();
    expect(player.remove).toHaveBeenCalledTimes(1);
  });

  it('a dead audio backend resolves false instead of throwing', async () => {
    const working = createAudioPlayer.getMockImplementation();
    createAudioPlayer.mockImplementation(() => {
      throw new Error('no audio session');
    });
    try {
      await expect(pronounce('hello')).resolves.toBe(false);
    } finally {
      createAudioPlayer.mockImplementation(working);
    }
  });
});

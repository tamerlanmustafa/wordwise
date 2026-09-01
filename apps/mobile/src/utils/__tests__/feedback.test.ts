/**
 * utils/feedback — the one module that fires haptic + sound + motion together
 * on every answer (issue #162). Logic-only per CLAUDE.md: the pure plan
 * matrix, the audio-mode matrix, the Reduce Motion branch, preload
 * idempotency, and the source guard that keeps `expo-haptics` / `expo-audio`
 * imports in this one file. Native modules are the spies in jest.setup.js.
 */

import fs from 'fs';
import path from 'path';
import { AccessibilityInfo } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ExpoAudio from 'expo-audio';
import {
  AUDIO_MODES,
  STREAK_EVERY,
  __reduceMotionForTests,
  feedback,
  isStreakMilestone,
  planFeedback,
  preload,
  release,
  type FeedbackMoment,
} from '../feedback';

type MockPlayer = {
  source: { testUri?: string } | number;
  play: jest.Mock;
  seekTo: jest.Mock;
  remove: jest.Mock;
};
const audioMock = ExpoAudio as unknown as { __players: MockPlayer[]; __reset: () => void };
const createAudioPlayer = jest.mocked(ExpoAudio.createAudioPlayer);
const setAudioModeAsync = jest.mocked(ExpoAudio.setAudioModeAsync);
const notificationAsync = jest.mocked(Haptics.notificationAsync);
const impactAsync = jest.mocked(Haptics.impactAsync);
const isReduceMotionEnabled = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
const addEventListener = jest.mocked(AccessibilityInfo.addEventListener);

/** The RN jest preset turns a required .wav into `{ testUri }`, so a player
 *  is found by the file its source points at. */
function playerFor(name: FeedbackMoment): MockPlayer | undefined {
  return audioMock.__players.find((p) => {
    const uri = typeof p.source === 'object' && p.source ? p.source.testUri : undefined;
    return typeof uri === 'string' && uri.endsWith(`${name}.wav`);
  });
}

/** `fire` awaits one audio-mode hop before `play()`; let it settle. */
const flush = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  release();
  audioMock.__reset();
  jest.clearAllMocks();
  isReduceMotionEnabled.mockResolvedValue(false);
});

describe('planFeedback — the channel matrix', () => {
  it.each<[FeedbackMoment, string]>([
    ['correct', 'success'],
    ['wrong', 'error'],
    ['streak', 'impact-medium'],
    ['complete', 'success'],
  ])('%s → %s haptic, its own sound, motion on', (moment, haptic) => {
    expect(planFeedback(moment, { reduceMotion: false })).toEqual({
      haptic,
      sound: moment,
      motion: true,
    });
  });

  it('Reduce Motion drops only the motion channel — haptic and sound are unchanged', () => {
    for (const moment of ['correct', 'wrong', 'streak', 'complete'] as const) {
      const on = planFeedback(moment, { reduceMotion: false });
      const off = planFeedback(moment, { reduceMotion: true });
      expect(off.motion).toBe(false);
      expect(off.haptic).toBe(on.haptic);
      expect(off.sound).toBe(on.sound);
    }
  });
});

describe('isStreakMilestone', () => {
  it(`fires on every ${STREAK_EVERY}th consecutive correct, never on a miss`, () => {
    expect(isStreakMilestone(0)).toBe(false);
    for (let run = 1; run < STREAK_EVERY; run++) expect(isStreakMilestone(run)).toBe(false);
    expect(isStreakMilestone(STREAK_EVERY)).toBe(true);
    expect(isStreakMilestone(STREAK_EVERY + 1)).toBe(false);
    expect(isStreakMilestone(STREAK_EVERY * 2)).toBe(true);
  });
});

describe('AUDIO_MODES — the silent-switch matrix', () => {
  it('UI chimes respect the iOS silent switch and mix over the user\'s music', () => {
    expect(AUDIO_MODES.ui.playsInSilentMode).toBe(false);
    expect(AUDIO_MODES.ui.interruptionMode).toBe('mixWithOthers');
  });

  it('pronunciation plays through the switch and ducks the music while it does', () => {
    expect(AUDIO_MODES.pronunciation.playsInSilentMode).toBe(true);
    expect(AUDIO_MODES.pronunciation.interruptionMode).toBe('duckOthers');
  });

  it('neither use records or plays in the background', () => {
    for (const mode of Object.values(AUDIO_MODES)) {
      expect(mode.allowsRecording).toBe(false);
      expect(mode.shouldPlayInBackground).toBe(false);
    }
  });
});

describe('preload / release', () => {
  it('creates one player per sound, once — a second preload is a no-op', async () => {
    await preload();
    expect(createAudioPlayer).toHaveBeenCalledTimes(4);
    await preload();
    expect(createAudioPlayer).toHaveBeenCalledTimes(4);
    expect(playerFor('correct')).toBeDefined();
    expect(playerFor('wrong')).toBeDefined();
    expect(playerFor('streak')).toBeDefined();
    expect(playerFor('complete')).toBeDefined();
  });

  it('release removes every player and a later preload builds fresh ones', async () => {
    await preload();
    const first = audioMock.__players.slice();
    release();
    for (const p of first) expect(p.remove).toHaveBeenCalledTimes(1);
    await preload();
    expect(createAudioPlayer).toHaveBeenCalledTimes(8);
  });

  it('release without a preload is safe', () => {
    expect(() => release()).not.toThrow();
  });

  it('reads Reduce Motion at preload so firing never awaits it', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);
    await preload();
    expect(__reduceMotionForTests()).toBe(true);
  });
});

describe('firing — all three channels from one call', () => {
  it('correct: Success haptic, the motion callback, and the correct chime', async () => {
    await preload();
    const motion = jest.fn();
    feedback.correct({ motion });
    expect(notificationAsync).toHaveBeenCalledWith('success');
    expect(motion).toHaveBeenCalledTimes(1);
    await flush();
    const chime = playerFor('correct')!;
    expect(chime.seekTo).toHaveBeenCalledWith(0);
    expect(chime.play).toHaveBeenCalledTimes(1);
    expect(playerFor('wrong')!.play).not.toHaveBeenCalled();
  });

  it('wrong: Error haptic and the thud', async () => {
    await preload();
    feedback.wrong();
    expect(notificationAsync).toHaveBeenCalledWith('error');
    await flush();
    expect(playerFor('wrong')!.play).toHaveBeenCalledTimes(1);
  });

  it('streak: Medium impact — not a second notification on top of correct', async () => {
    await preload();
    feedback.streak();
    expect(impactAsync).toHaveBeenCalledWith('medium');
    expect(notificationAsync).not.toHaveBeenCalled();
    await flush();
    expect(playerFor('streak')!.play).toHaveBeenCalledTimes(1);
  });

  it('complete: Success haptic and the resolving chord', async () => {
    await preload();
    feedback.complete();
    expect(notificationAsync).toHaveBeenCalledWith('success');
    await flush();
    expect(playerFor('complete')!.play).toHaveBeenCalledTimes(1);
  });

  it('applies the UI audio mode before EVERY play, even after pronunciation flipped the session', async () => {
    await preload();
    // A pronunciation tap in between configures the shared session to play
    // through the silent switch. The next chime must undo that first.
    await setAudioModeAsync(AUDIO_MODES.pronunciation);
    feedback.correct();
    await flush();
    const modeCalls = setAudioModeAsync.mock.calls;
    expect(modeCalls[modeCalls.length - 1][0]).toEqual(AUDIO_MODES.ui);
    const modeOrder = setAudioModeAsync.mock.invocationCallOrder.slice(-1)[0];
    const playOrder = playerFor('correct')!.play.mock.invocationCallOrder[0];
    expect(modeOrder).toBeLessThan(playOrder);
  });

  it('works without a preload — players are created lazily on the first fire', async () => {
    feedback.correct();
    expect(createAudioPlayer).toHaveBeenCalledTimes(4);
    await flush();
    expect(playerFor('correct')!.play).toHaveBeenCalledTimes(1);
  });

  it('a dead audio backend never breaks the answer — haptic and motion still fire', () => {
    const working = createAudioPlayer.getMockImplementation();
    createAudioPlayer.mockImplementation(() => {
      throw new Error('no audio session');
    });
    try {
      const motion = jest.fn();
      expect(() => feedback.wrong({ motion })).not.toThrow();
      expect(notificationAsync).toHaveBeenCalledWith('error');
      expect(motion).toHaveBeenCalledTimes(1);
    } finally {
      createAudioPlayer.mockImplementation(working);
    }
  });
});

describe('Reduce Motion', () => {
  it('skips the motion callback; haptic and sound still fire', async () => {
    isReduceMotionEnabled.mockResolvedValue(true);
    await preload();
    const motion = jest.fn();
    feedback.wrong({ motion });
    expect(motion).not.toHaveBeenCalled();
    expect(notificationAsync).toHaveBeenCalledWith('error');
    await flush();
    expect(playerFor('wrong')!.play).toHaveBeenCalledTimes(1);
  });

  it('follows a mid-session change through the reduceMotionChanged listener', async () => {
    await preload();
    // The RN typing is an overload per event name; the mock records them all.
    const calls = addEventListener.mock.calls as unknown as Array<[string, (enabled: boolean) => void]>;
    const sub = calls.find(([event]) => event === 'reduceMotionChanged');
    expect(sub).toBeDefined();
    const handler = sub![1];

    handler(true);
    const skipped = jest.fn();
    feedback.correct({ motion: skipped });
    expect(skipped).not.toHaveBeenCalled();

    handler(false);
    const ran = jest.fn();
    feedback.correct({ motion: ran });
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe('source guard — one file owns the native feedback modules', () => {
  const SRC = path.join(__dirname, '..', '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full, out);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('only utils/feedback.ts and utils/pronunciation.ts import expo-haptics or expo-audio', () => {
    const offenders = walk(SRC)
      .filter((file) => /['"]expo-(haptics|audio)['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file))
      .sort();
    expect(offenders).toEqual(['utils/feedback.ts', 'utils/pronunciation.ts']);
  });
});

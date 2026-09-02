/**
 * utils/feedback (#179) — the plan is pure and tested directly; the fire path
 * is driven through the expo-av / expo-haptics mocks in jest.setup.js.
 *
 * The import guard at the bottom is the point of the module: if a second file
 * starts calling expo-haptics directly, the policy stops being decided in one
 * place and screens start buzzing twice.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Haptics from 'expo-haptics';
import * as ExpoAv from 'expo-av';
import { DEFAULT_FEEDBACK_PREFS, useFeedbackPrefsStore } from '../../stores/feedbackPrefsStore';
import { feedback, planFeedback, preload, release } from '../feedback';

const avMock = ExpoAv as unknown as {
  __sounds: { replayAsync: jest.Mock; unloadAsync: jest.Mock }[];
  __reset: () => void;
};
const notificationAsync = jest.mocked(Haptics.notificationAsync);
const impactAsync = jest.mocked(Haptics.impactAsync);
const setAudioModeAsync = jest.mocked(ExpoAv.Audio.setAudioModeAsync);

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(async () => {
  await release();
  avMock.__reset();
  jest.clearAllMocks();
  useFeedbackPrefsStore.setState({ ...DEFAULT_FEEDBACK_PREFS, hydrated: true });
});

describe('planFeedback — what each moment may fire', () => {
  const on = { soundEnabled: true, hapticsEnabled: true };

  it('a right answer gets the success haptic and its chime', () => {
    expect(planFeedback('correct', on)).toEqual({ haptic: 'success', sound: 'correct' });
  });

  it('a wrong answer gets the error haptic and its chime', () => {
    expect(planFeedback('wrong', on)).toEqual({ haptic: 'error', sound: 'wrong' });
  });

  it('a button tap is haptic-only — a chime on every press is how sound gets turned off', () => {
    expect(planFeedback('tap', on)).toEqual({ haptic: 'light', sound: null });
  });

  it('the switches gate their own channel and nothing else', () => {
    expect(planFeedback('correct', { soundEnabled: false, hapticsEnabled: true })).toEqual({
      haptic: 'success',
      sound: null,
    });
    expect(planFeedback('correct', { soundEnabled: true, hapticsEnabled: false })).toEqual({
      haptic: null,
      sound: 'correct',
    });
  });

  it('both off fires nothing at all', () => {
    expect(planFeedback('wrong', { soundEnabled: false, hapticsEnabled: false })).toEqual({
      haptic: null,
      sound: null,
    });
  });
});

describe('firing', () => {
  it('a correct answer fires the success haptic and replays the chime', async () => {
    await preload();
    feedback.correct();
    await flush();

    expect(notificationAsync).toHaveBeenCalledWith('success');
    expect(avMock.__sounds[0].replayAsync).toHaveBeenCalled();
  });

  it('uses the UI audio mode, so a chime stays silent on a muted phone', async () => {
    await preload();
    feedback.wrong();
    await flush();
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ playsInSilentModeIOS: false }),
    );
  });

  it('a tap buzzes but never plays a sound', async () => {
    await preload();
    feedback.tap();
    await flush();

    expect(impactAsync).toHaveBeenCalledWith('light');
    for (const sound of avMock.__sounds) expect(sound.replayAsync).not.toHaveBeenCalled();
  });

  it('sound off silences the chime but keeps the haptic', async () => {
    await preload();
    useFeedbackPrefsStore.getState().setSoundEnabled(false);

    feedback.correct();
    await flush();

    expect(notificationAsync).toHaveBeenCalledWith('success');
    for (const sound of avMock.__sounds) expect(sound.replayAsync).not.toHaveBeenCalled();
  });

  it('haptics off keeps the chime', async () => {
    await preload();
    useFeedbackPrefsStore.getState().setHapticsEnabled(false);

    feedback.correct();
    await flush();

    expect(notificationAsync).not.toHaveBeenCalled();
    expect(avMock.__sounds[0].replayAsync).toHaveBeenCalled();
  });

  it('replays rather than reloading — a player per answer would hitch the frame', async () => {
    await preload();
    const created = avMock.__sounds.length;

    feedback.correct();
    feedback.correct();
    await flush();

    expect(avMock.__sounds).toHaveLength(created);
    expect(avMock.__sounds[0].replayAsync).toHaveBeenCalledTimes(2);
  });

  it('loads the chimes on first use when nothing preloaded them', async () => {
    feedback.correct();
    await flush();
    expect(avMock.__sounds.length).toBeGreaterThan(0);
  });

  it('a haptic failure never stops the sound — the channels are independent', async () => {
    await preload();
    notificationAsync.mockRejectedValueOnce(new Error('no haptic engine'));

    expect(() => feedback.correct()).not.toThrow();
    await flush();
    expect(avMock.__sounds[0].replayAsync).toHaveBeenCalled();
  });

  it('preload is idempotent, so a second session screen does not double the players', async () => {
    await preload();
    const created = avMock.__sounds.length;
    await preload();
    expect(avMock.__sounds).toHaveLength(created);
  });

  it('release unloads every player', async () => {
    await preload();
    const sounds = [...avMock.__sounds];
    await release();
    for (const sound of sounds) expect(sound.unloadAsync).toHaveBeenCalled();
  });

  it('release during an in-flight preload still unloads what that load created', async () => {
    const loading = preload(); // deliberately not awaited
    await release();
    await loading;

    expect(avMock.__sounds.length).toBeGreaterThan(0);
    for (const sound of avMock.__sounds) expect(sound.unloadAsync).toHaveBeenCalled();
  });
});

describe('the single-owner rule', () => {
  it('utils/feedback is the only file that imports expo-haptics', () => {
    const root = path.join(__dirname, '..', '..');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const rel = path.relative(root, full);
          if (rel === path.join('utils', 'feedback.ts')) continue;
          if (fs.readFileSync(full, 'utf8').includes('expo-haptics')) offenders.push(rel);
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });
});

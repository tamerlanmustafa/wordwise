/**
 * feedbackPrefsStore — the Sound and Haptics switches (issue #179).
 *
 * Two independent booleans, both defaulting on, persisted across launches the
 * same way `themeStore` persists the theme.
 *
 * Independent on purpose: they are not two intensities of one preference.
 * Sound is a social constraint — a quiet office, a sleeping passenger next to
 * you — while haptics is a bodily one, and plenty of people want a phone that
 * buzzes silently or chimes without vibrating. Collapsing them into a single
 * "Effects" toggle would force a choice neither group wants to make.
 *
 * Read synchronously via `getFeedbackPrefs()` from the fire path: feedback has
 * to be decided on the frame the user acted, so nothing on that path may await
 * storage. The hydrate happens once at startup, and until it lands the
 * defaults apply — a first launch that chimes is the correct wrong answer.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'wordwise.feedback.v1';

export interface FeedbackPrefs {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

export const DEFAULT_FEEDBACK_PREFS: FeedbackPrefs = {
  soundEnabled: true,
  hapticsEnabled: true,
};

interface FeedbackPrefsState extends FeedbackPrefs {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setSoundEnabled: (on: boolean) => void;
  setHapticsEnabled: (on: boolean) => void;
}

/**
 * Anything stored by an older or newer build is treated as absent rather than
 * trusted — a preference read is not worth a crash on launch, and the default
 * (both on) is the safe answer.
 */
export function parseStoredPrefs(raw: string | null): FeedbackPrefs {
  if (!raw) return DEFAULT_FEEDBACK_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<FeedbackPrefs>;
    return {
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_FEEDBACK_PREFS.soundEnabled,
      hapticsEnabled:
        typeof parsed.hapticsEnabled === 'boolean'
          ? parsed.hapticsEnabled
          : DEFAULT_FEEDBACK_PREFS.hapticsEnabled,
    };
  } catch {
    return DEFAULT_FEEDBACK_PREFS;
  }
}

function persist(prefs: FeedbackPrefs): void {
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

export const useFeedbackPrefsStore = create<FeedbackPrefsState>((set, get) => ({
  ...DEFAULT_FEEDBACK_PREFS,
  hydrated: false,

  hydrate: async () => {
    try {
      const prefs = parseStoredPrefs(await AsyncStorage.getItem(KEY));
      set({ ...prefs, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setSoundEnabled: (on) => {
    set({ soundEnabled: on });
    const { soundEnabled, hapticsEnabled } = get();
    persist({ soundEnabled, hapticsEnabled });
  },

  setHapticsEnabled: (on) => {
    set({ hapticsEnabled: on });
    const { soundEnabled, hapticsEnabled } = get();
    persist({ soundEnabled, hapticsEnabled });
  },
}));

/** Synchronous read for the fire path, which cannot await a hook or storage. */
export function getFeedbackPrefs(): FeedbackPrefs {
  const { soundEnabled, hapticsEnabled } = useFeedbackPrefsStore.getState();
  return { soundEnabled, hapticsEnabled };
}

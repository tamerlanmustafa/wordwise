/* eslint-disable no-undef */
// Global jest setup for the mobile test suite.
//
// Mocks the two native storage modules every store/service depends on so
// individual test files don't have to repeat the boilerplate. Test files can
// still override these with their own jest.mock(...) when they need bespoke
// behaviour. Reset state between tests with AsyncStorage.clear() /
// SecureStore __reset() in a beforeEach.

// AsyncStorage — use the library's official in-memory jest mock (same one the
// existing PracticeTilePath test wires up inline).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-secure-store — minimal in-memory implementation backing tokenStorage
// on the native (Platform.OS !== 'web') code path.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
    __reset: () => store.clear(),
  };
});

// expo-glass-effect — ships untranspiled ESM, which the react-native preset
// does not transform, so importing GlobalBottomBar would throw on the `export`
// keyword. Mocking it also states the truth about the environment: there is no
// iOS 26 under jest, so the availability checks are false and GlassView is a
// plain View — exactly what the package's own non-iOS build does. Tests
// therefore exercise the pinned-bar fallback, and anything asserting the glass
// path has to say so explicitly.
jest.mock('expo-glass-effect', () => {
  const { View } = require('react-native');
  return {
    GlassView: View,
    GlassContainer: View,
    isLiquidGlassAvailable: () => false,
    isGlassEffectAPIAvailable: () => false,
  };
});

// expo-av — in-memory Audio.Sound. There is no audio hardware under jest, so
// the mock's job is to record what the app asked for (the source, crucially
// including its headers) and to let a test drive playback to an end:
//   __sounds        every sound created, newest last
//   sound.__emit(s) delivers a status update to that sound's listener
//   __failNextLoad  makes the next createAsync reject, the 401/load-error path
jest.mock('expo-av', () => {
  const sounds = [];
  let failNextLoad = false;

  const createAsync = jest.fn(async (source, initialStatus) => {
    if (failNextLoad) {
      failNextLoad = false;
      throw new Error('Load failed: 401');
    }
    const sound = {
      source,
      initialStatus,
      listener: null,
      setOnPlaybackStatusUpdate: jest.fn(function (cb) {
        this.listener = cb;
      }),
      unloadAsync: jest.fn(async () => {}),
      playAsync: jest.fn(async () => {}),
      replayAsync: jest.fn(async () => {}),
      stopAsync: jest.fn(async () => {}),
      setPositionAsync: jest.fn(async () => {}),
      __emit(status) {
        this.listener?.({ isLoaded: true, didJustFinish: false, ...status });
      },
    };
    sounds.push(sound);
    return { sound, status: { isLoaded: true } };
  });

  return {
    Audio: {
      Sound: { createAsync },
      setAudioModeAsync: jest.fn(async () => {}),
    },
    InterruptionModeIOS: { MixWithOthers: 0, DoNotMix: 1, DuckOthers: 2 },
    InterruptionModeAndroid: { DoNotMix: 1, DuckOthers: 2 },
    __sounds: sounds,
    __failNextLoad: () => {
      failNextLoad = true;
    },
    __reset: () => {
      sounds.length = 0;
      failNextLoad = false;
    },
  };
});

// expo-haptics — there is no haptic engine under jest. Calls are recorded so a
// test can assert which one a moment fired without a device.
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

// Silence the intentional console.warn noise from optional-native-module
// fallbacks (billing / notifications require()-guard their imports) so test
// output stays readable. Runs at setup time (before the test framework is
// installed, so no beforeAll/afterEach available here — a plain top-level
// spy is fine and applies for the whole file).
const realWarn = console.warn.bind(console);
jest.spyOn(console, 'warn').mockImplementation((...args) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (
    first.includes('[billing]') ||
    first.includes('[notifications]') ||
    first.includes('expo-in-app-purchases') ||
    // Expected warnings from error-path branches the suite deliberately drives
    // (rollback on a rejected reel mutation; the fire-and-forget /auth/me
    // refresh that can't run under Jest's dynamic-import limitation).
    first.includes('[reelStore]') ||
    first.includes('[AuthStore]')
  ) {
    return;
  }
  realWarn(...args);
});

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

// expo-haptics / expo-audio — the two channels behind utils/feedback.ts. There
// is no Taptic Engine or audio session under jest, so both are spies that
// resolve immediately; feedback.test.ts asserts on what was called. The
// audio mock keeps every created player so a test can find "the correct
// chime" by its source and check it was played, rewound, or released.
// Players also record `addListener` subscriptions so pronunciation.test.ts
// can deliver a `playbackStatusUpdate` (`__emit`) and check it was dropped.
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
}));

jest.mock('expo-audio', () => {
  const players = [];
  return {
    createAudioPlayer: jest.fn((source) => {
      const listeners = [];
      const player = {
        source,
        play: jest.fn(),
        pause: jest.fn(),
        seekTo: jest.fn(async () => {}),
        remove: jest.fn(),
        addListener: jest.fn((event, fn) => {
          const entry = { event, fn };
          listeners.push(entry);
          return {
            remove: jest.fn(() => {
              const i = listeners.indexOf(entry);
              if (i >= 0) listeners.splice(i, 1);
            }),
          };
        }),
        /** Test-only: deliver an event to every live listener. */
        __emit: (event, payload) => {
          for (const entry of listeners.slice()) {
            if (entry.event === event) entry.fn(payload);
          }
        },
        __listenerCount: () => listeners.length,
        volume: 1,
        isLoaded: true,
        playing: false,
      };
      players.push(player);
      return player;
    }),
    setAudioModeAsync: jest.fn(async () => {}),
    __players: players,
    __reset: () => {
      players.length = 0;
    },
  };
});

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

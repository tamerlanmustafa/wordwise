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

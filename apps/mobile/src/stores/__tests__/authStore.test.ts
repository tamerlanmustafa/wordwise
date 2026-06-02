import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/auth/tokenStorage', () => ({
  tokenStorage: {
    saveTokens: jest.fn(async () => {}),
    clearTokens: jest.fn(async () => {}),
    getTokens: jest.fn(),
  },
}));

// initialize() does a background `import('../services/api')` for the /auth/me
// refresh. Metro transforms that dynamic import into a require; Jest (Node, no
// --experimental-vm-modules) cannot execute a native import(), so under test
// the refresh always lands in its own .catch and is a no-op. We therefore mock
// the module only to keep the real api (and its native deps) from loading, and
// we assert the *synchronous* cached-auth contract rather than the refresh.
jest.mock('../../services/api', () => ({
  authApi: { me: jest.fn() },
}));

import { useAuthStore } from '../authStore';
import { tokenStorage } from '../../services/auth/tokenStorage';
import type { User } from '../../types';

const flush = () => new Promise<void>((r) => setImmediate(r));

const user = (over: Partial<User> = {}): User => ({
  id: 1,
  email: 'a@b.com',
  username: 'alice',
  profile_picture_url: null,
  native_language: 'en',
  learning_language: 'es',
  proficiency_level: 'B1',
  default_tab: 'movies',
  is_admin: false,
  ...over,
});

const mockGetTokens = tokenStorage.getTokens as jest.Mock;
const mockSaveTokens = tokenStorage.saveTokens as jest.Mock;
const mockClearTokens = tokenStorage.clearTokens as jest.Mock;

describe('authStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    useAuthStore.setState({ status: 'loading', user: null });
  });

  describe('login', () => {
    it('saves tokens, persists the user, and flips to authenticated', async () => {
      const u = user();
      await useAuthStore.getState().login(u, 'access-tok', 'refresh-tok');

      expect(mockSaveTokens).toHaveBeenCalledWith('access-tok', 'refresh-tok');
      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().user).toEqual(u);
      expect(JSON.parse((await AsyncStorage.getItem('user'))!)).toEqual(u);
    });
  });

  describe('logout', () => {
    it('clears tokens + cached user and flips to unauthenticated', async () => {
      await AsyncStorage.setItem('user', JSON.stringify(user()));
      useAuthStore.setState({ user: user(), status: 'authenticated' });

      await useAuthStore.getState().logout();

      expect(mockClearTokens).toHaveBeenCalled();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(await AsyncStorage.getItem('user')).toBeNull();
    });
  });

  describe('setUser', () => {
    it('updates the user and persists the edit so it survives a cold start', async () => {
      const u = user({ username: 'renamed' });
      useAuthStore.getState().setUser(u);
      expect(useAuthStore.getState().user).toEqual(u);
      await flush();
      expect(JSON.parse((await AsyncStorage.getItem('user'))!)).toMatchObject({ username: 'renamed' });
    });
  });

  describe('setStatus', () => {
    it('sets the auth status field', () => {
      useAuthStore.getState().setStatus('offline_authenticated');
      expect(useAuthStore.getState().status).toBe('offline_authenticated');
    });
  });

  describe('initialize', () => {
    it('authenticates synchronously from cached tokens + user on cold start', async () => {
      const cached = user({ username: 'cached' });
      await AsyncStorage.setItem('user', JSON.stringify(cached));
      mockGetTokens.mockResolvedValue({ access: 'a', refresh: 'r' });

      await useAuthStore.getState().initialize();

      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().user).toEqual(cached);
    });

    it('leaves the cached user intact — the /auth/me refresh is fire-and-forget', async () => {
      // The background refresh is best-effort; whether it succeeds or fails, a
      // cold start must never downgrade an already-authenticated cached user.
      const cached = user({ username: 'cached' });
      await AsyncStorage.setItem('user', JSON.stringify(cached));
      mockGetTokens.mockResolvedValue({ access: 'a', refresh: 'r' });

      await useAuthStore.getState().initialize();
      await flush();

      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().user).toEqual(cached);
    });

    it('is unauthenticated when there are no tokens', async () => {
      mockGetTokens.mockResolvedValue(null);
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });

    it('is unauthenticated when tokens exist but no user is cached', async () => {
      mockGetTokens.mockResolvedValue({ access: 'a', refresh: 'r' });
      // No 'user' key in AsyncStorage.
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });

    it('falls back to unauthenticated if token lookup throws', async () => {
      mockGetTokens.mockRejectedValue(new Error('keystore boom'));
      await useAuthStore.getState().initialize();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });
  });
});

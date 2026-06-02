import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useEntitlementsStore,
  useIsPremium,
  useShowAds,
} from '../entitlementsStore';
import { useAuthStore } from '../authStore';
import { renderHook, cleanupHooks } from '../../test-utils/renderHook';
import type { Entitlements, User } from '../../types';

const STORAGE_KEY = 'admin_view_mode';

const ent = (over: Partial<Entitlements>): Entitlements => ({
  tier: 'free',
  is_premium: false,
  is_admin: false,
  ads_eligible: true,
  subscription_expires_at: null,
  ...over,
});

const userWith = (entitlements: Entitlements | null): User => ({
  id: 1,
  email: 'a@b.com',
  username: 'a',
  profile_picture_url: null,
  native_language: 'en',
  learning_language: 'es',
  proficiency_level: 'B1',
  default_tab: 'movies',
  is_admin: entitlements?.is_admin ?? false,
  entitlements,
});

describe('entitlementsStore — admin preview toggle', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useEntitlementsStore.setState({ adminViewMode: 'admin' });
    useAuthStore.setState({ user: null, status: 'authenticated' });
  });

  describe('setAdminViewMode / hydrate', () => {
    it('updates and persists the chosen mode', async () => {
      await useEntitlementsStore.getState().setAdminViewMode('free');
      expect(useEntitlementsStore.getState().adminViewMode).toBe('free');
      expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('free');
    });

    it('hydrate restores a valid persisted mode', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'premium');
      await useEntitlementsStore.getState().hydrate();
      expect(useEntitlementsStore.getState().adminViewMode).toBe('premium');
    });

    it('hydrate ignores a garbage persisted value', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'superuser');
      await useEntitlementsStore.getState().hydrate();
      expect(useEntitlementsStore.getState().adminViewMode).toBe('admin');
    });
  });
});

describe('effective entitlements (useIsPremium / useShowAds)', () => {
  beforeEach(() => {
    useEntitlementsStore.setState({ adminViewMode: 'admin' });
    useAuthStore.setState({ user: null, status: 'authenticated' });
  });

  afterEach(() => cleanupHooks());

  it('a logged-out / entitlement-less user is treated as a free, ad-eligible user', () => {
    useAuthStore.setState({ user: userWith(null) });
    expect(renderHook(() => useIsPremium()).result.current).toBe(false);
    expect(renderHook(() => useShowAds()).result.current).toBe(true);
  });

  it('a real premium (non-admin) user is premium and ad-free; the toggle is a no-op', () => {
    useAuthStore.setState({ user: userWith(ent({ tier: 'premium', is_premium: true, ads_eligible: false })) });
    // Even if some admin mode leaked into state, a non-admin must see reality.
    useEntitlementsStore.setState({ adminViewMode: 'free' });
    expect(renderHook(() => useIsPremium()).result.current).toBe(true);
    expect(renderHook(() => useShowAds()).result.current).toBe(false);
  });

  it('an admin in default "admin" mode sees their real entitlements', () => {
    useAuthStore.setState({
      user: userWith(ent({ tier: 'premium', is_premium: true, is_admin: true, ads_eligible: false })),
    });
    useEntitlementsStore.setState({ adminViewMode: 'admin' });
    expect(renderHook(() => useIsPremium()).result.current).toBe(true);
    expect(renderHook(() => useShowAds()).result.current).toBe(false);
  });

  it('an admin previewing "free" sees ads and loses premium (but stays admin)', () => {
    useAuthStore.setState({
      user: userWith(ent({ tier: 'premium', is_premium: true, is_admin: true, ads_eligible: false })),
    });
    useEntitlementsStore.setState({ adminViewMode: 'free' });
    expect(renderHook(() => useIsPremium()).result.current).toBe(false);
    expect(renderHook(() => useShowAds()).result.current).toBe(true);
  });

  it('an admin previewing "premium" hides ads and unlocks Plus', () => {
    useAuthStore.setState({
      user: userWith(ent({ tier: 'free', is_premium: false, is_admin: true, ads_eligible: true })),
    });
    useEntitlementsStore.setState({ adminViewMode: 'premium' });
    expect(renderHook(() => useIsPremium()).result.current).toBe(true);
    expect(renderHook(() => useShowAds()).result.current).toBe(false);
  });
});

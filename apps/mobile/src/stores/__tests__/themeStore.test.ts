import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useThemeStore } from '../themeStore';

const KEY = 'wordwise.theme.v1';
const flush = () => new Promise<void>((r) => setImmediate(r));

describe('themeStore', () => {
  let schemeSpy: jest.SpyInstance;

  beforeEach(async () => {
    await AsyncStorage.clear();
    schemeSpy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('dark');
    useThemeStore.setState({ preference: 'system', resolved: 'dark', hydrated: false });
  });

  afterEach(() => schemeSpy.mockRestore());

  describe('resolution', () => {
    it('"system" follows the device color scheme', () => {
      useThemeStore.getState().setPreference('system');
      expect(useThemeStore.getState().resolved).toBe('dark');
    });

    it('"light" forces light regardless of device', () => {
      useThemeStore.getState().setPreference('light');
      expect(useThemeStore.getState().resolved).toBe('light');
    });

    it('"dark" forces dark regardless of device', () => {
      schemeSpy.mockReturnValue('light');
      useThemeStore.getState().setPreference('dark');
      expect(useThemeStore.getState().resolved).toBe('dark');
    });
  });

  describe('persistence', () => {
    it('persists an explicit preference', async () => {
      useThemeStore.getState().setPreference('light');
      await flush();
      expect(await AsyncStorage.getItem(KEY)).toBe('light');
    });

    it('hydrate restores a stored preference and re-resolves it', async () => {
      await AsyncStorage.setItem(KEY, 'light');
      await useThemeStore.getState().hydrate();
      expect(useThemeStore.getState()).toMatchObject({
        preference: 'light',
        resolved: 'light',
        hydrated: true,
      });
    });

    it('hydrate falls back to "system" when storage is empty', async () => {
      await useThemeStore.getState().hydrate();
      expect(useThemeStore.getState().preference).toBe('system');
      expect(useThemeStore.getState().resolved).toBe('dark'); // device scheme
    });
  });
});

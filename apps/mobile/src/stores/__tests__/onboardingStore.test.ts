import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOnboardingStore } from '../onboardingStore';

const KEY = 'onboarding.v1';
const flush = () => Promise.resolve();

describe('onboardingStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useOnboardingStore.setState({
      completed: false,
      targetLanguage: undefined,
      startingLevel: undefined,
      dailyGoalMinutes: undefined,
      hydrated: false,
    });
  });

  describe('hydrate', () => {
    it('marks a brand-new user as not completed (flow should show)', async () => {
      await useOnboardingStore.getState().hydrate();
      const s = useOnboardingStore.getState();
      expect(s.completed).toBe(false);
      expect(s.hydrated).toBe(true);
    });

    it('restores a completed user verbatim (app should show, not the flow)', async () => {
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ completed: true, targetLanguage: 'FR', startingLevel: 'B2', dailyGoalMinutes: 12 }),
      );
      await useOnboardingStore.getState().hydrate();
      const s = useOnboardingStore.getState();
      expect(s).toMatchObject({
        completed: true,
        targetLanguage: 'FR',
        startingLevel: 'B2',
        dailyGoalMinutes: 12,
        hydrated: true,
      });
    });

    it('treats malformed persisted JSON as a fresh (incomplete) user', async () => {
      await AsyncStorage.setItem(KEY, 'not json');
      await useOnboardingStore.getState().hydrate();
      expect(useOnboardingStore.getState().completed).toBe(false);
      expect(useOnboardingStore.getState().hydrated).toBe(true);
    });
  });

  describe('complete', () => {
    it('flips completed, stores the choices, and persists them', async () => {
      await useOnboardingStore.getState().complete({
        targetLanguage: 'ES',
        startingLevel: 'B1',
        dailyGoalMinutes: 6,
      });
      const s = useOnboardingStore.getState();
      expect(s).toMatchObject({ completed: true, targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 6 });

      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!)).toEqual({
        completed: true,
        targetLanguage: 'ES',
        startingLevel: 'B1',
        dailyGoalMinutes: 6,
      });
    });

    it('a hydrate after complete keeps the user out of the flow', async () => {
      await useOnboardingStore.getState().complete({ targetLanguage: 'ES', startingLevel: 'A2', dailyGoalMinutes: 3 });
      // Simulate a fresh app launch reading from storage.
      useOnboardingStore.setState({ completed: false, hydrated: false });
      await useOnboardingStore.getState().hydrate();
      expect(useOnboardingStore.getState().completed).toBe(true);
    });
  });

  describe('setDailyGoalMinutes', () => {
    it('updates the goal and persists the merged shape', async () => {
      await useOnboardingStore.getState().complete({ targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 6 });
      await useOnboardingStore.getState().setDailyGoalMinutes(12);
      expect(useOnboardingStore.getState().dailyGoalMinutes).toBe(12);

      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!)).toMatchObject({ completed: true, targetLanguage: 'ES', startingLevel: 'B1', dailyGoalMinutes: 12 });
    });
  });

  describe('reset', () => {
    it('clears completion + persisted state (back to the flow)', async () => {
      await useOnboardingStore.getState().complete({ targetLanguage: 'ES', startingLevel: 'C1', dailyGoalMinutes: 20 });
      await useOnboardingStore.getState().reset();
      expect(useOnboardingStore.getState().completed).toBe(false);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });
  });
});

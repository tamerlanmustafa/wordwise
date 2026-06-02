import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDailyGoalStore, DAILY_GOAL } from '../dailyGoalStore';

const KEY = 'journey.dailyGoal.v1';
const flush = () => Promise.resolve();

// Construct an explicit local-noon Date so todayLocal() (which reads local
// y/m/d fields) is deterministic regardless of the machine timezone. Months
// are 0-indexed: month 5 === June.
const dayNoon = (y: number, m0: number, d: number) => new Date(y, m0, d, 12, 0, 0);

const setDay = (date: Date) => jest.setSystemTime(date);

describe('dailyGoalStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useFakeTimers();
    setDay(dayNoon(2026, 5, 2)); // 2026-06-02
    useDailyGoalStore.setState({
      date: '2026-06-02',
      done: 0,
      streak: 0,
      lastHitDate: null,
      hydrated: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('the daily goal anchor is a single session', () => {
    expect(DAILY_GOAL).toBe(1);
  });

  describe('hydrate', () => {
    it('initialises a brand-new user to a clean same-day state', async () => {
      await useDailyGoalStore.getState().hydrate();
      const s = useDailyGoalStore.getState();
      expect(s).toMatchObject({
        date: '2026-06-02',
        done: 0,
        streak: 0,
        lastHitDate: null,
        hydrated: true,
      });
    });

    it('restores same-day persisted state verbatim', async () => {
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ date: '2026-06-02', done: 1, streak: 5, lastHitDate: '2026-06-02' }),
      );
      await useDailyGoalStore.getState().hydrate();
      expect(useDailyGoalStore.getState()).toMatchObject({ done: 1, streak: 5 });
    });

    it('rolls the day, zeroes `done`, and KEEPS the streak when yesterday hit goal', async () => {
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ date: '2026-06-01', done: 1, streak: 5, lastHitDate: '2026-06-01' }),
      );
      await useDailyGoalStore.getState().hydrate(); // today is 2026-06-02
      const s = useDailyGoalStore.getState();
      expect(s.done).toBe(0);
      expect(s.streak).toBe(5); // yesterday was the last hit → unbroken
      expect(s.date).toBe('2026-06-02');
    });

    it('breaks the streak when a day was skipped', async () => {
      setDay(dayNoon(2026, 5, 4)); // jump to 2026-06-04 (skipped the 3rd)
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ date: '2026-06-02', done: 1, streak: 5, lastHitDate: '2026-06-02' }),
      );
      await useDailyGoalStore.getState().hydrate();
      expect(useDailyGoalStore.getState().streak).toBe(0);
    });

    it('breaks the streak when the prior day was opened but goal was NOT hit', async () => {
      // lastHitDate (05-31) predates persisted.date (06-01) → goal missed on the 1st.
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ date: '2026-06-01', done: 0, streak: 5, lastHitDate: '2026-05-31' }),
      );
      await useDailyGoalStore.getState().hydrate(); // today 06-02
      expect(useDailyGoalStore.getState().streak).toBe(0);
    });
  });

  describe('bump', () => {
    it('first session of the day hits goal, starts streak at 1, and reports justHitGoal', () => {
      const r = useDailyGoalStore.getState().bump();
      expect(r).toEqual({ done: 1, streak: 1, justHitGoal: true });
      expect(useDailyGoalStore.getState().lastHitDate).toBe('2026-06-02');
    });

    it('a second same-day session is a bonus: done++ but streak unchanged, justHitGoal false', () => {
      useDailyGoalStore.getState().bump();
      const r = useDailyGoalStore.getState().bump();
      expect(r.done).toBe(2);
      expect(r.streak).toBe(1);
      expect(r.justHitGoal).toBe(false);
    });

    it('continues the streak when consecutive days each hit goal', () => {
      useDailyGoalStore.getState().bump(); // 06-02 → streak 1
      setDay(dayNoon(2026, 5, 3)); // 06-03
      const r = useDailyGoalStore.getState().bump();
      expect(r.streak).toBe(2);
      expect(r.justHitGoal).toBe(true);
    });

    it('restarts the streak at 1 after a skipped day', () => {
      useDailyGoalStore.getState().bump(); // 06-02 → streak 1
      setDay(dayNoon(2026, 5, 5)); // 06-05, skipped 03 + 04
      const r = useDailyGoalStore.getState().bump();
      expect(r.streak).toBe(1);
    });

    it('defensively rolls the day inside bump even if hydrate never fired across midnight', () => {
      useDailyGoalStore.getState().bump(); // 06-02, done 1
      setDay(dayNoon(2026, 5, 3)); // crossed midnight, no hydrate
      const r = useDailyGoalStore.getState().bump();
      expect(r.done).toBe(1); // reset to 0 then +1, not 2
      expect(r.streak).toBe(2);
    });

    it('persists the bumped state', async () => {
      useDailyGoalStore.getState().bump();
      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!)).toMatchObject({ done: 1, streak: 1, lastHitDate: '2026-06-02' });
    });
  });
});

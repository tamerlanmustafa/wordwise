import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNotificationsStore,
  pruneReadIds,
  selectHasUnread,
} from '../notificationsStore';
import { useDailyGoalStore } from '../dailyGoalStore';
import { srsApi } from '../../services/api';

jest.mock('../../services/api', () => ({
  srsApi: { stats: jest.fn() },
}));

const mockStats = srsApi.stats as jest.Mock;

const READ_KEY = 'notifications.read.v1';

// Local-noon date so todayLocal() is timezone-proof (month is 0-indexed).
const dayNoon = (y: number, m0: number, d: number) => new Date(y, m0, d, 12, 0, 0);

const statsWith = (due_now: number) => ({
  total_saved: 40,
  due_now,
  due_today: due_now,
  by_box: {},
  is_premium: false,
  previews_remaining: 3,
  current_streak: 0,
  longest_streak: 0,
  total_reviews: 0,
  total_correct: 0,
  retention_pct: 0,
});

describe('notificationsStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(dayNoon(2026, 6, 15)); // 2026-07-15
    mockStats.mockReset();
    mockStats.mockResolvedValue(statsWith(0));
    useNotificationsStore.setState({ items: [], hydrated: false, readIds: new Set() });
    useDailyGoalStore.setState({
      date: '2026-07-15',
      done: 0,
      streak: 0,
      lastHitDate: null,
      hydrated: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('refresh: item derivation', () => {
    it('a fresh account gets only the welcome notification', async () => {
      await useNotificationsStore.getState().refresh();
      const items = useNotificationsStore.getState().items;
      expect(items.map((i) => i.kind)).toEqual(['welcome']);
      expect(selectHasUnread(useNotificationsStore.getState())).toBe(true);
    });

    it('due reviews produce a dated reviews_due item targeting the review screen', async () => {
      mockStats.mockResolvedValue(statsWith(12));
      await useNotificationsStore.getState().refresh();
      const item = useNotificationsStore.getState().items[0];
      expect(item).toMatchObject({
        id: 'reviews-due-2026-07-15',
        kind: 'reviews_due',
        target: 'review',
        read: false,
      });
      expect(item.body).toContain('12 words');
    });

    it('uses singular copy for exactly one due word', async () => {
      mockStats.mockResolvedValue(statsWith(1));
      await useNotificationsStore.getState().refresh();
      expect(useNotificationsStore.getState().items[0].body).toContain('1 word is');
    });

    it('an active streak not yet hit today raises streak_risk', async () => {
      useDailyGoalStore.setState({ streak: 6, lastHitDate: '2026-07-14' });
      await useNotificationsStore.getState().refresh();
      const item = useNotificationsStore.getState().items.find((i) => i.kind === 'streak_risk');
      expect(item).toMatchObject({ id: 'streak-risk-2026-07-15', target: 'practice' });
      expect(item!.title).toContain('6-day');
    });

    it('no streak_risk once the goal is hit today', async () => {
      useDailyGoalStore.setState({ streak: 6, lastHitDate: '2026-07-15' });
      await useNotificationsStore.getState().refresh();
      expect(
        useNotificationsStore.getState().items.some((i) => i.kind === 'streak_risk')
      ).toBe(false);
    });

    it('a failing stats call (offline) still yields the local items', async () => {
      mockStats.mockRejectedValue(new Error('network down'));
      useDailyGoalStore.setState({ streak: 3, lastHitDate: '2026-07-14' });
      await useNotificationsStore.getState().refresh();
      expect(useNotificationsStore.getState().items.map((i) => i.kind)).toEqual([
        'streak_risk',
        'welcome',
      ]);
    });
  });

  describe('read state', () => {
    it('markRead flips the item, persists, and survives a refresh', async () => {
      mockStats.mockResolvedValue(statsWith(5));
      await useNotificationsStore.getState().refresh();
      await useNotificationsStore.getState().markRead('reviews-due-2026-07-15');

      expect(useNotificationsStore.getState().items[0].read).toBe(true);

      // A new refresh regenerates items but keeps the read join.
      await useNotificationsStore.getState().refresh();
      expect(useNotificationsStore.getState().items[0].read).toBe(true);

      const persisted = JSON.parse((await AsyncStorage.getItem(READ_KEY))!);
      expect(persisted).toContain('reviews-due-2026-07-15');
    });

    it('a read welcome is dropped on the next refresh, permanently', async () => {
      await useNotificationsStore.getState().refresh();
      await useNotificationsStore.getState().markRead('welcome-v1');
      await useNotificationsStore.getState().refresh();
      expect(
        useNotificationsStore.getState().items.some((i) => i.kind === 'welcome')
      ).toBe(false);
    });

    it("yesterday's read id does not silence today's notification", async () => {
      await AsyncStorage.setItem(READ_KEY, JSON.stringify(['reviews-due-2026-07-14']));
      mockStats.mockResolvedValue(statsWith(2));
      await useNotificationsStore.getState().refresh();
      const item = useNotificationsStore.getState().items[0];
      expect(item.id).toBe('reviews-due-2026-07-15');
      expect(item.read).toBe(false);
    });

    it('markAllRead clears the unread dot', async () => {
      mockStats.mockResolvedValue(statsWith(5));
      useDailyGoalStore.setState({ streak: 2, lastHitDate: '2026-07-14' });
      await useNotificationsStore.getState().refresh();
      expect(selectHasUnread(useNotificationsStore.getState())).toBe(true);

      await useNotificationsStore.getState().markAllRead();
      expect(selectHasUnread(useNotificationsStore.getState())).toBe(false);
      const persisted = JSON.parse((await AsyncStorage.getItem(READ_KEY))!);
      expect(persisted).toEqual(
        expect.arrayContaining(['reviews-due-2026-07-15', 'streak-risk-2026-07-15', 'welcome-v1'])
      );
    });

    it('hydrate loads persisted read ids before the first refresh', async () => {
      await AsyncStorage.setItem(READ_KEY, JSON.stringify(['welcome-v1']));
      await useNotificationsStore.getState().refresh(); // auto-hydrates
      expect(
        useNotificationsStore.getState().items.some((i) => i.kind === 'welcome')
      ).toBe(false);
    });
  });

  describe('pruneReadIds', () => {
    it('drops dated ids past the window, keeps recent and undated ones', () => {
      const kept = pruneReadIds(
        ['reviews-due-2026-05-01', 'reviews-due-2026-07-10', 'welcome-v1'],
        '2026-07-15'
      );
      expect(kept).toEqual(['reviews-due-2026-07-10', 'welcome-v1']);
    });
  });
});

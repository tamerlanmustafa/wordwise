/**
 * notificationsStore — feeds the Home-header bell and its NotificationsSheet.
 *
 * MVP model: notifications are DERIVED, not pushed. `refresh()` recomputes
 * the list from what the app already knows (SRS due counts, the daily-goal
 * streak) instead of a server inbox — there's no backend table to sync or
 * poll. Only the *read* state is persisted (AsyncStorage), keyed by
 * deterministic ids (`reviews-due-2026-07-15`) so a notification the user
 * has opened stays read across refreshes but re-arms the next day.
 *
 * Sources (in display order):
 *   • reviews_due  — GET /srs/stats `due_now` > 0 (skipped while offline)
 *   • streak_risk  — dailyGoalStore: active streak, goal not hit today
 *   • welcome      — static one-timer; once read it never returns
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { srsApi } from '../services/api';
import { useDailyGoalStore } from './dailyGoalStore';
import { t } from '../i18n';

const READ_KEY = 'notifications.read.v1';
/** Dated read-ids older than this are pruned so storage can't grow forever. */
const PRUNE_AFTER_DAYS = 30;

export type AppNotificationKind = 'reviews_due' | 'streak_risk' | 'welcome';

/** Screen a tapped notification should land on. */
export type NotificationTarget = 'review' | 'practice';

export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body: string;
  read: boolean;
  target?: NotificationTarget;
}

interface NotificationsState {
  items: AppNotification[];
  hydrated: boolean;
  /** Persisted ids the user has already opened/dismissed. */
  readIds: Set<string>;
  hydrate: () => Promise<void>;
  /** Recompute items from current app state; joins persisted read flags. */
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Drop dated ids older than the prune window; undated ids (welcome-v1)
 *  are kept forever. */
export function pruneReadIds(ids: readonly string[], today: string): string[] {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - PRUNE_AFTER_DAYS);
  return ids.filter((id) => {
    const match = id.match(/(\d{4}-\d{2}-\d{2})$/);
    if (!match) return true;
    return new Date(match[1]) >= cutoff;
  });
}

async function loadReadIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(pruneReadIds(parsed.filter((s) => typeof s === 'string'), todayLocal()));
  } catch {
    return new Set();
  }
}

async function saveReadIds(ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(READ_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* best-effort */
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  hydrated: false,
  readIds: new Set<string>(),

  hydrate: async () => {
    const readIds = await loadReadIds();
    set({ readIds, hydrated: true });
  },

  refresh: async () => {
    if (!get().hydrated) await get().hydrate();
    const today = todayLocal();
    const items: AppNotification[] = [];

    // Reviews due — network-backed, so offline just means no item this pass.
    try {
      const stats = await srsApi.stats();
      if (stats.due_now > 0) {
        items.push({
          id: `reviews-due-${today}`,
          kind: 'reviews_due',
          title: t('notifications:reviewsDue.title'),
          body: t('notifications:reviewsDue.body', { count: stats.due_now }),
          read: false,
          target: 'review',
        });
      }
    } catch {
      /* offline / signed out — skip */
    }

    // Streak at risk — an active streak whose goal hasn't been hit today.
    const daily = useDailyGoalStore.getState();
    if (daily.streak > 0 && daily.lastHitDate !== today) {
      items.push({
        id: `streak-risk-${today}`,
        kind: 'streak_risk',
        title: t('notifications:streakRisk.title', { count: daily.streak }),
        body: t('notifications:streakRisk.body'),
        read: false,
        target: 'practice',
      });
    }

    // Welcome one-timer: shown until opened once, then gone for good
    // (its read id has no date, so pruning never resurrects it).
    items.push({
      id: 'welcome-v1',
      kind: 'welcome',
      title: t('notifications:welcome.title'),
      body: t('notifications:welcome.body'),
      read: false,
    });

    const { readIds } = get();
    set({
      items: items
        .map((i) => ({ ...i, read: readIds.has(i.id) }))
        // A read welcome is dismissed, not archived — drop it entirely.
        .filter((i) => !(i.kind === 'welcome' && i.read)),
    });
  },

  markRead: async (id) => {
    const readIds = new Set(get().readIds);
    readIds.add(id);
    set({
      readIds,
      items: get().items.map((i) => (i.id === id ? { ...i, read: true } : i)),
    });
    await saveReadIds(readIds);
  },

  markAllRead: async () => {
    const readIds = new Set(get().readIds);
    for (const item of get().items) readIds.add(item.id);
    set({
      readIds,
      items: get().items.map((i) => ({ ...i, read: true })),
    });
    await saveReadIds(readIds);
  },
}));

/** Selector: does the bell need its unread dot? */
export const selectHasUnread = (s: NotificationsState): boolean =>
  s.items.some((i) => !i.read);

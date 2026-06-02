import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMilestoneTrackerStore } from '../milestoneTrackerStore';

const KEY = 'milestones.seen.v1';

describe('milestoneTrackerStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    useMilestoneTrackerStore.setState({ seen: new Set(), hydrated: false });
  });

  describe('hydrate', () => {
    it('starts empty when nothing is persisted', async () => {
      await useMilestoneTrackerStore.getState().hydrate();
      expect(useMilestoneTrackerStore.getState().seen.size).toBe(0);
      expect(useMilestoneTrackerStore.getState().hydrated).toBe(true);
    });

    it('restores a persisted slug list into the set', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify(['box_office', 'cult_classic']));
      await useMilestoneTrackerStore.getState().hydrate();
      const { seen } = useMilestoneTrackerStore.getState();
      expect(seen.has('box_office')).toBe(true);
      expect(seen.has('cult_classic')).toBe(true);
    });

    it('filters non-string garbage out of a corrupt array', async () => {
      await AsyncStorage.setItem(KEY, JSON.stringify(['box_office', 42, null]));
      await useMilestoneTrackerStore.getState().hydrate();
      expect(Array.from(useMilestoneTrackerStore.getState().seen)).toEqual(['box_office']);
    });

    it('tolerates malformed JSON', async () => {
      await AsyncStorage.setItem(KEY, '{not json');
      await useMilestoneTrackerStore.getState().hydrate();
      expect(useMilestoneTrackerStore.getState().seen.size).toBe(0);
    });
  });

  describe('newSince', () => {
    it('returns only slugs not yet seen, preserving order', async () => {
      await useMilestoneTrackerStore.getState().markSeen(['opening_weekend']);
      const fresh = useMilestoneTrackerStore
        .getState()
        .newSince(['opening_weekend', 'box_office', 'cult_classic']);
      expect(fresh).toEqual(['box_office', 'cult_classic']);
    });

    it('does NOT mark the returned slugs as seen (caller defers)', () => {
      useMilestoneTrackerStore.getState().newSince(['box_office']);
      expect(useMilestoneTrackerStore.getState().seen.has('box_office')).toBe(false);
    });

    it('returns an empty list when everything is already seen', async () => {
      await useMilestoneTrackerStore.getState().markSeen(['a', 'b']);
      expect(useMilestoneTrackerStore.getState().newSince(['a', 'b'])).toEqual([]);
    });
  });

  describe('markSeen', () => {
    it('adds slugs and persists them', async () => {
      await useMilestoneTrackerStore.getState().markSeen(['box_office']);
      expect(useMilestoneTrackerStore.getState().seen.has('box_office')).toBe(true);
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!)).toContain('box_office');
    });

    it('is idempotent for already-seen values (no dupes)', async () => {
      await useMilestoneTrackerStore.getState().markSeen(['box_office']);
      await useMilestoneTrackerStore.getState().markSeen(['box_office', 'cult_classic']);
      const raw = await AsyncStorage.getItem(KEY);
      const arr = JSON.parse(raw!) as string[];
      expect(arr.filter((s) => s === 'box_office')).toHaveLength(1);
      expect(arr).toContain('cult_classic');
    });

    it('no-ops on an empty slug list', async () => {
      await useMilestoneTrackerStore.getState().markSeen([]);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });
  });
});

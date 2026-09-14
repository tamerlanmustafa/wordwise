import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFirstSessionStore } from '../firstSessionStore';

const KEY = 'has_opened_before';

/** A cold start: the store is new, whatever is on disk stays. */
const relaunch = () => useFirstSessionStore.getState()._reset();

describe('firstSessionStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    relaunch();
  });

  it('reads a fresh install as a first session', async () => {
    await useFirstSessionStore.getState().hydrate();
    expect(useFirstSessionStore.getState()).toMatchObject({ hydrated: true, openedBefore: false });
  });

  it('reads a returning install as opened before', async () => {
    await AsyncStorage.setItem(KEY, '1');
    await useFirstSessionStore.getState().hydrate();
    expect(useFirstSessionStore.getState().openedBefore).toBe(true);
  });

  it('marking the visit does not put the ad slot under the reader mid-session', async () => {
    // The slot must be decided once, before the feed draws. Flipping it here
    // would push the list down part-way through the first session.
    await useFirstSessionStore.getState().hydrate();
    await useFirstSessionStore.getState().markOpened();

    expect(useFirstSessionStore.getState().openedBefore).toBe(false);
    expect(await AsyncStorage.getItem(KEY)).toBe('1');
  });

  it('shows it from the first frame of the next launch', async () => {
    await useFirstSessionStore.getState().markOpened();
    relaunch();
    await useFirstSessionStore.getState().hydrate();
    expect(useFirstSessionStore.getState().openedBefore).toBe(true);
  });

  it('never writes the flag before reading it', async () => {
    // A feed mounting before launch's read answered must not make this launch
    // look like a returning one.
    const pending = useFirstSessionStore.getState().markOpened();
    await pending;
    expect(useFirstSessionStore.getState().openedBefore).toBe(false);
  });

  it('shares one read between every caller', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem');
    spy.mockClear(); // the shared mock carries earlier tests' calls
    await Promise.all([
      useFirstSessionStore.getState().hydrate(),
      useFirstSessionStore.getState().hydrate(),
      useFirstSessionStore.getState().markOpened(),
    ]);
    expect(spy.mock.calls.filter(([k]) => k === KEY)).toHaveLength(1);
    spy.mockRestore();
  });

  it('treats unreadable storage as a first session — no ad is the safe mistake', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('nope'));
    await useFirstSessionStore.getState().hydrate();
    expect(useFirstSessionStore.getState()).toMatchObject({ hydrated: true, openedBefore: false });
    spy.mockRestore();
  });
});

/**
 * accountState — what belongs to the account, and what happens to it at
 * sign-out.
 *
 * ## The bug this exists to prevent
 *
 * Signing out used to clear exactly two things: the tokens and the cached
 * `user` blob. Everything else the app had written stayed on the device under
 * a global key, so the *next* account to sign in on that phone inherited it —
 * the previous user's in-flight review deck (i.e. their saved vocabulary, on
 * screen), their streak, their recently-viewed films, their reading positions,
 * their onboarding answers.
 *
 * None of that was visible while the app was used the way it is usually used:
 * one person, one phone, never signing out. It surfaced the moment a second
 * identity appeared, which is the same reason the Practice lesson number could
 * read 34 on one phone and 8 on another for months.
 *
 * ## The rule
 *
 * Every persisted key is scoped to exactly one of two things, and the choice
 * is recorded here rather than left implicit in whichever module happened to
 * write it:
 *
 *   • **Account** — it describes the person. It must not survive sign-out.
 *   • **Device**  — it describes this phone or this install. It must survive,
 *                   because clearing it would be a worse bug: signing out and
 *                   back in should not reset your theme or re-show the splash.
 *
 * A key that is neither is a key nobody has thought about, so
 * `__tests__/accountState.test.ts` fails the build on any storage key in
 * `src/` that is not listed below.
 *
 * ## Storage is only half of it
 *
 * These stores are module-level singletons: they outlive a sign-out, and most
 * of them refuse to re-hydrate once `hydrated` is true. Clearing AsyncStorage
 * alone would leave the previous account's data on screen until the app was
 * killed, which is exactly the symptom we are removing. `resetAccountState`
 * therefore does both, and the store resets are the half that the user
 * actually sees.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Keys that describe the signed-in person. Cleared on sign-out.
 *
 * Kept as literals rather than imported from each module on purpose: this list
 * has to stay readable as a whole, and an import cycle through fifteen stores
 * to build a delete list would be worse than the duplication. The guard test
 * is what keeps the two in step.
 */
export const ACCOUNT_KEYS: readonly string[] = [
  'user',                          // cached profile (authStore)
  'onboarding.v1',                 // completion + the answers it captured
  'targetLanguage',                // translation language (also on the account)
  'journey.dailyGoal.v1',          // local streak mirror
  'journey.reelSeedDone.v1',       // "this account has been seeded"
  'srs.reviewSession.v2',          // in-flight deck — the other user's words
  'notifications.read.v1',
  'milestones.seen.v1',            // which unlocks have been celebrated
  'tips.dismissed.v1',
  'feedLevelMix',                  // Explore mix (also on the account)
  'feedBuffer.v1',                 // last Explore page, already personalised
  'feedListMembership.v1',         // which words this user has saved
  'recently_viewed_movies',
  'last_opened_movie',
  'sync.queue.v1',                 // queued writes must never replay as someone else
  'offline_vocab_index',           // index for the offline_vocab_ blobs below
  'practice.path.cursor.v1',       // pre-2026-09-04 lesson cursor, un-scoped
];

/**
 * Key *families* that describe the person. Matched by prefix because their
 * names carry an id — a film, a lemma, a user — so they cannot be enumerated.
 */
export const ACCOUNT_KEY_PREFIXES: readonly string[] = [
  'movie_bookmark_',               // reading position, per film
  'practice.path.cursor.v2:',      // already per-user; cleared to keep the device tidy
  'offline_vocab_',                // cached vocabulary blobs
  'swr_',                          // cached API responses, all authenticated
];

/**
 * Keys that describe the phone, not the person. **Deliberately kept** across a
 * sign-out — the reasons are as load-bearing as the ones above.
 */
export const DEVICE_KEYS: readonly string[] = [
  'wordwise.theme.v1',             // light/dark is a property of the screen
  'wordwise.feedback.v1',          // sound + haptics
  'wordwise.appLanguage.v1',       // mirrors users.language_preference; re-derived on login
  'wordwise.splashShown.v1',
  'admin_view_mode',               // inert unless the account is an admin
  'vocab_view_mode',
  'lists.activeKind.v1',           // which tab of Lists was last open
  'has_opened_before',
  'journey.rtwShelf.dismissedDate',
];

/** Shared-content caches keyed by hour/language, not by user. */
export const DEVICE_KEY_PREFIXES: readonly string[] = ['word_of_hour_v1:'];

/** True when `key` is one this module considers the account's. */
export function isAccountKey(key: string): boolean {
  return (
    ACCOUNT_KEYS.includes(key) ||
    ACCOUNT_KEY_PREFIXES.some((p) => key.startsWith(p))
  );
}

/**
 * Delete everything belonging to the account that just signed out.
 *
 * Enumerates the real keyspace rather than deleting a fixed list, so the
 * prefix families are covered — and one `multiRemove` rather than N deletes,
 * because this runs while the user is watching the sign-out happen.
 */
export async function clearAccountStorage(): Promise<void> {
  try {
    const all = await AsyncStorage.getAllKeys();
    const doomed = all.filter(isAccountKey);
    if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  } catch {
    // Best-effort: a failed wipe must not strand the user in a session they
    // asked to end. The stores are reset either way, so nothing stale is on
    // screen; the worst case is that it reappears after an app restart.
  }
}

/**
 * Drop the previous account's data out of memory.
 *
 * Required, not belt-and-braces: these stores are singletons that survive
 * sign-out, and most guard `hydrate()` behind a `hydrated` flag that is still
 * true — so without this the next account reads the last one's feed, streak
 * and deck straight from memory.
 *
 * Imported lazily. `authStore` is the caller, and half of these stores import
 * `authStore` themselves; a static import here would close that cycle and
 * Metro resolves one side of a cycle as `undefined` at module-init time.
 */
export function resetAccountStores(): void {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const stores = [
    () => require('../stores/practicePathStore').usePracticePathStore.getState()._resetTo(0),
    () => require('../stores/onboardingStore').useOnboardingStore.getState().reset(),
    () => require('../stores/dailyGoalStore').useDailyGoalStore.getState().reset(),
    () => require('../stores/wordFeedStore').useWordFeedStore.getState().reset(),
    () => require('../stores/listsStore').useListsStore.getState().reset(),
    () => require('../stores/reelStore').useReelStore.getState().reset(),
    () => require('../stores/reviewSessionStore').useReviewSessionStore.getState().clear(),
    () => require('../stores/notificationsStore').useNotificationsStore.getState().reset(),
    () => require('../stores/milestoneTrackerStore').useMilestoneTrackerStore.getState().reset(),
    () => require('../stores/tipDismissalsStore').useTipDismissalsStore.getState().reset(),
  ];
  for (const resetOne of stores) {
    try {
      resetOne();
    } catch {
      // One store failing to reset must not leave the other nine holding the
      // previous account's data.
    }
  }
}

/** Sign-out: forget the account, keep the phone's own settings. */
export async function resetAccountState(): Promise<void> {
  resetAccountStores();
  await clearAccountStorage();
}

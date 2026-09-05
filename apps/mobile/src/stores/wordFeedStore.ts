/**
 * wordFeedStore — paging + actions for the Explore word feed.
 *
 * Mirrors `reelStore`'s paging shape (optimistic writes, rollback on
 * failure, AsyncStorage for anything that must survive a relaunch).
 *
 * Two things shape how this store behaves on a cold start:
 *
 *   • `mix`    — the CEFR blend the user dialled in (key `feedLevelMix`).
 *   • `buffer` — the tail of the cards fetched last launch (key `feedBuffer`).
 *                Restored and reshuffled before the first request is even
 *                sent, so the tab paints a word immediately instead of a
 *                skeleton. The fetch that follows appends behind it, so
 *                nothing the user is already looking at moves.
 *
 * The feed is deliberately amnesiac about position. Every launch mints a new
 * `sessionSeed`, which the server uses to shuffle its candidate pool, so
 * reopening the app is a fresh scroll rather than a resumed one. (It used to
 * seed on the UTC date, which made the first card identical all day.) The
 * seed is minted once and echoed on every page of the session: `offset`
 * addresses a stable sequence only for as long as the seed holds still.
 *
 * The heart ("Save") is the existing global word save — a `user_words` row
 * with no movie — which is what puts the word in the notebook and the next
 * SRS session. There is no separate favourite column.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, srsApi, wordwiseApi, type FeedItem, type LevelMix } from '../services/api';
import { useAuthStore } from './authStore';
import { useListsStore } from './listsStore';
import { cutsToMix, defaultMixForLevel, isBalanced, mixToCuts, sameMix } from '../utils/levelMix';
import { randomToken, shuffle } from '../utils/random';

const MIX_KEY = 'feedLevelMix';
const BUFFER_KEY = 'feedBuffer.v1';
const MEMBERSHIP_KEY = 'feedListMembership.v1';

/** The two slide-in panels share one lane, so at most one is ever open. */
export type PanelId = 'mix' | 'list' | null;

export const FEED_PAGE_SIZE = 20;

/** Prefetch when the user is this many cards from the end. */
export const PREFETCH_THRESHOLD = 2;

/** How many recent cards to keep on disk for the next cold start. Deep
 *  enough that a launch has real runway before it needs the network, small
 *  enough that parsing it is not itself the thing delaying first paint. */
export const BUFFER_LIMIT = 60;

/** Buffered cards older than this are dropped rather than shown — lemmas get
 *  curated away and translations get corrected underneath us. */
export const BUFFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface BufferedFeed {
  /** The language the cards were translated into. A buffer in the wrong
   *  language is worse than no buffer at all. */
  lang: string | null;
  savedAt: number;
  items: FeedItem[];
}

interface WordFeedState {
  items: FeedItem[];
  loading: boolean;
  /** True once the server says there are no more pages. */
  exhausted: boolean;
  loadError: boolean;
  mix: LevelMix;
  /** What the server actually honoured on the last page. */
  mixApplied: LevelMix;
  activeIndex: number;
  /** Lemma ids the user has saved this session, for the heart's fill. */
  saved: Set<number>;
  hydrated: boolean;
  /** Which slide-in panel is open, if any. Lives here rather than in the
   *  screen so App's Android back handler can close it before leaving the
   *  tab. Only one can be open at a time — they occupy the same lane. */
  openPanel: PanelId;
  /** Which lists each lemma has been added to, by lemma id.
   *
   *  Session/device-local and persisted: the API has no "which lists is this
   *  word in" endpoint, and deriving it would mean fetching every list's
   *  items on every panel open. Adds are idempotent server-side, so the worst
   *  case of a stale local set is a redundant add, never a wrong one. */
  listMembership: Record<number, number[]>;

  hydrate: (
    proficiencyLevel?: string | null,
    targetLang?: string | null,
    /** The mix stored on the account, when it has one. Wins over the local
     *  cache: the mix is a setting the user dialled in, and it used to live
     *  only in AsyncStorage, so each phone held a different one. */
    accountMix?: LevelMix | null,
  ) => Promise<void>;
  fetchNext: () => Promise<void>;
  setMix: (mix: LevelMix) => Promise<void>;
  setActiveIndex: (index: number) => void;
  setPanelOpen: (panel: PanelId) => void;
  toggleList: (item: FeedItem, listId: number) => Promise<void>;
  favourite: (item: FeedItem) => Promise<void>;
  reset: () => void;
}

/** Kept outside the store: these are request parameters, not UI state, and
 *  putting them in state would re-render every card when they resolve. */
let targetLanguage: string | null = null;

/** Fixes the server's order for this launch. Re-minted on hydrate and on
 *  any mix change — both are moments the deck should be dealt again. */
let sessionSeed: string = randomToken();

/** Where the last page stopped, per CEFR level. Kept outside the store for
 *  the same reason as the seed: it is a request parameter, and putting it in
 *  state would re-render every card each time a page lands.
 *
 *  Reset wherever `sessionSeed` is, because a cursor only means anything
 *  against the order the seed produced. */
let feedCursors: Record<string, string> = {};

/** Synchronous re-entry guard for `hydrate`. `hydrated` can't do this job on
 *  its own: it is only set after two awaits, so two callers arriving in the
 *  same tick — App's boot effect and the Explore screen's mount effect — would
 *  both sail past it and fetch page 0 twice. */
let hydrating = false;

async function persistMembership(membership: Record<number, number[]>): Promise<void> {
  try {
    // Drop emptied entries so the blob doesn't grow with every un-tick.
    const pruned = Object.fromEntries(
      Object.entries(membership).filter(([, ids]) => ids.length > 0),
    );
    await AsyncStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(pruned));
  } catch {
    // Losing this only costs the rail its label until the next add.
  }
}

async function readMembership(): Promise<Record<number, number[]>> {
  try {
    const stored = await AsyncStorage.getItem(MEMBERSHIP_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<number, number[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function persistBuffer(items: FeedItem[], saved: Set<number>): Promise<void> {
  // Keep the tail. Fresh pages append, so the newest cards are the ones the
  // next launch is least likely to have already shown. Saved words are
  // dropped because the server excludes them from future pages — leaving
  // them here would resurface a word the user has already filed away.
  const keep = items.filter((i) => !saved.has(i.lemma_id)).slice(-BUFFER_LIMIT);
  if (keep.length === 0) return;

  const payload: BufferedFeed = {
    lang: targetLanguage,
    savedAt: Date.now(),
    items: keep,
  };
  try {
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(payload));
  } catch {
    // The buffer is an optimisation. Failing to write it costs the next
    // launch its instant first card and nothing else.
  }
}

async function readBuffer(): Promise<FeedItem[]> {
  try {
    const stored = await AsyncStorage.getItem(BUFFER_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as BufferedFeed;
    if (!Array.isArray(parsed?.items) || parsed.items.length === 0) return [];
    // Showing Spanish translations to someone who has switched to Turkish is
    // a worse first impression than a brief skeleton.
    if (parsed.lang !== targetLanguage) return [];
    if (Date.now() - (parsed.savedAt ?? 0) > BUFFER_TTL_MS) return [];

    return parsed.items;
  } catch {
    // An unreadable buffer just means a normal, network-bound cold start.
    return [];
  }
}

export const useWordFeedStore = create<WordFeedState>((set, get) => ({
  items: [],
  loading: false,
  exhausted: false,
  loadError: false,
  mix: defaultMixForLevel('B1'),
  mixApplied: {},
  activeIndex: 0,
  saved: new Set<number>(),
  hydrated: false,
  openPanel: null,
  listMembership: {},

  hydrate: async (proficiencyLevel, targetLang, accountMix) => {
    if (hydrating || get().hydrated) return;
    hydrating = true;

    targetLanguage = targetLang ?? null;
    // A new launch is a new deck, and a cursor into the old one means
    // nothing against the new order.
    sessionSeed = randomToken();
    feedCursors = {};

    // Precedence: the account's mix, then this device's last one, then a
    // default derived from the user's level. The account comes first because
    // it is the only copy a second phone can see.
    let mix = defaultMixForLevel(proficiencyLevel);
    if (accountMix && isBalanced(accountMix)) {
      mix = accountMix;
    } else {
      try {
        const stored = await AsyncStorage.getItem(MIX_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as LevelMix;
          if (parsed && typeof parsed === 'object') {
            // A four-level mix written by the previous build arrives with A1
            // and C2 simply absent. Those read as 0, so it already totals 100
            // and passes through untouched — falling back to the default
            // because two keys are missing would silently reset the mix of
            // every existing user. Anything that *doesn't* total 100 (the old
            // panel's half-assigned state, a torn write) is scaled and snapped
            // through the cuts instead of discarded, so its shape survives too.
            mix = isBalanced(parsed) ? parsed : cutsToMix(mixToCuts(parsed));
          }
        }
      } catch {
        // Fall through to the default.
      }
    }

    // Paint last launch's cards, in a new order, before the request is sent.
    const buffered = await readBuffer();
    const listMembership = await readMembership();

    set({ mix, items: shuffle(buffered), listMembership, hydrated: true });
    // `hydrated` is the guard from here on.
    hydrating = false;

    await get().fetchNext();
  },

  fetchNext: async () => {
    const { loading, exhausted, mix, items } = get();
    if (loading || exhausted) return;

    set({ loading: true, loadError: false });
    try {
      const res = await srsApi.feed({
        limit: FEED_PAGE_SIZE,
        // A keyset position, not a page number: the server orders by a hash
        // of (lemma, seed) and returns where each level stopped. An offset
        // would slide every time the user saves a word, because saving
        // removes that word from the pool the offset is counting into.
        cursors: feedCursors,
        targetLang: targetLanguage ?? undefined,
        mix,
        seed: sessionSeed,
      });

      // Drop anything already on screen. With a restored buffer this does
      // real work rather than being belt-and-braces: the server has no idea
      // what we cached, so its first page can legitimately re-offer a word
      // the user is holding, and a duplicate key in a FlatList is worse than
      // a short page.
      const known = new Set(items.map((i) => i.lemma_id));
      const fresh = res.items.filter((i) => !known.has(i.lemma_id));
      const next = [...items, ...fresh];

      // Advance before anything can early-return, so a page that was entirely
      // deduped still moves the cursor forward instead of asking for the same
      // rows again.
      if (res.cursors) feedCursors = res.cursors;

      set({
        items: next,
        mixApplied: res.mix_applied ?? {},
        // An empty page means the deal is read out, whatever `has_more` says.
        // Without this the prefetch effect would keep firing against a server
        // that has nothing left to give.
        //
        // A response with no `cursors` at all is a server from before keyset
        // paging — a rollback, or an OTA that landed ahead of its deploy. It
        // cannot advance us, so every page would be page one, deduped to
        // nothing, forever. Stop instead: one page of real words beats a
        // silent request loop.
        exhausted: !res.has_more || res.items.length === 0 || !res.cursors,
        loading: false,
      });

      // Fire-and-forget: only the next cold start reads this.
      persistBuffer(next, get().saved);
    } catch (e) {
      console.warn('[wordFeedStore] fetchNext failed:', e);
      set({ loading: false, loadError: true });
    }
  },

  setMix: async (mix) => {
    // A mix that doesn't total 100 is a legal panel state but never a
    // legal feed state — the server rejects it, so stop here.
    if (!isBalanced(mix)) return;

    // Deliberately before the early return: the mix held in memory on a first
    // run is a default nobody has written yet, so an unchanged Done is still
    // the moment to make it durable.
    try {
      await AsyncStorage.setItem(MIX_KEY, JSON.stringify(mix));
    } catch {
      // Persisting is best-effort; the mix still applies this session.
    }
    // …and onto the account, so the user's other phone gets the same feed.
    // Fire-and-forget for the same reason the local write is best-effort: the
    // mix already applies to this session, and a failed sync is retried by the
    // next change rather than blocking the panel's Done button on the network.
    authApi
      .updateProfile({ feed_level_mix: mix })
      .then((fresh) => useAuthStore.getState().setUser(fresh))
      .catch(() => {});

    // Opening the panel, changing nothing, and tapping Done must not cost the
    // user their place. Everything below throws the deck away and refetches,
    // which is right when the proportions moved and pure destruction when they
    // did not — and it is what lets the reload *mean* "your change landed"
    // instead of firing whether or not anything happened.
    if (sameMix(mix, get().mix)) return;

    // The buffer holds the previous mix's levels, so restoring it next
    // launch would contradict the proportions just dialled in. A new seed
    // makes this a genuinely new deck rather than the old one re-cut.
    AsyncStorage.removeItem(BUFFER_KEY).catch(() => {});
    sessionSeed = randomToken();
    feedCursors = {};

    // Reset to page 0 so the new proportions are visible immediately
    // rather than after the current page drains.
    set({
      mix,
      items: [],
      activeIndex: 0,
      exhausted: false,
      loading: false,
    });
    await get().fetchNext();
  },

  setActiveIndex: (index) => {
    if (index === get().activeIndex) return;
    set({ activeIndex: index });
  },

  setPanelOpen: (panel) => set({ openPanel: panel }),

  /** Membership is a set, not an assignment — a word can sit in several
   *  lists at once, and tapping a row toggles just that one. Optimistic,
   *  because the panel stays open and the user is expected to tick more. */
  toggleList: async (item, listId) => {
    const before = get().listMembership;
    const current = before[item.lemma_id] ?? [];
    const isMember = current.includes(listId);
    const next = isMember
      ? current.filter((id) => id !== listId)
      : [...current, listId];

    const optimistic = { ...before, [item.lemma_id]: next };
    set({ listMembership: optimistic });
    persistMembership(optimistic);

    try {
      const lists = useListsStore.getState();
      if (isMember) {
        // Word lists key their items on the word itself, not the lemma id.
        await lists.removeItem(listId, item.word);
      } else {
        await lists.addItems(listId, {
          words: [{ word: item.word, lemma_id: item.lemma_id }],
        });
      }
      wordwiseApi.logInteraction(
        item.word,
        isMember ? 'WORD_UNSAVE' : 'WORD_SAVE',
        null,
        { lemma_id: item.lemma_id, cefr: item.cefr, source: 'feed', list_id: listId },
      );
    } catch (e) {
      console.warn('[wordFeedStore] toggleList failed, rolling back:', e);
      set({ listMembership: before });
      persistMembership(before);
    }
  },

  favourite: async (item) => {
    const before = get().saved;
    const wasSaved = before.has(item.lemma_id);

    const optimistic = new Set(before);
    if (wasSaved) optimistic.delete(item.lemma_id);
    else optimistic.add(item.lemma_id);
    set({ saved: optimistic });

    try {
      const res = await wordwiseApi.saveWord(item.word);
      // The endpoint toggles server-side; trust its answer over ours.
      const confirmed = new Set(get().saved);
      if (res.saved) confirmed.add(item.lemma_id);
      else confirmed.delete(item.lemma_id);
      set({ saved: confirmed });

      // Keep the buffer in step, so a word saved now doesn't come back on
      // the next cold start via the cache.
      persistBuffer(get().items, confirmed);

      wordwiseApi.logInteraction(
        item.word,
        res.saved ? 'WORD_SAVE' : 'WORD_UNSAVE',
        null,
        { lemma_id: item.lemma_id, cefr: item.cefr, source: 'feed' },
      );
    } catch (e) {
      console.warn('[wordFeedStore] favourite failed, rolling back:', e);
      set({ saved: before });
    }
  },

  reset: () => {
    hydrating = false;
    set({
      items: [],
      loading: false,
      exhausted: false,
      loadError: false,
      activeIndex: 0,
      saved: new Set<number>(),
      hydrated: false,
      openPanel: null,
  listMembership: {},
    });
  },
}));

/** Fire-and-forget: the card flip is interaction data for the difficulty
 *  aggregate described in WORD_FEED_PLAN.md, not something the UI awaits. */
export function logFeedFlip(item: FeedItem): void {
  wordwiseApi.logInteraction(item.word, 'TRANSLATION_VIEW', null, {
    lemma_id: item.lemma_id,
    cefr: item.cefr,
    source: 'feed',
  });
}

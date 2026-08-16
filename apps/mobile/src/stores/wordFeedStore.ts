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
import { srsApi, wordwiseApi, type FeedItem, type LevelMix } from '../services/api';
import { defaultMixForLevel, isBalanced } from '../utils/levelMix';
import { randomToken, shuffle } from '../utils/random';

const MIX_KEY = 'feedLevelMix';
const BUFFER_KEY = 'feedBuffer.v1';

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
  page: number;
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
  /** Whether a slide-in panel is open. Lives here rather than in the screen
   *  so App's Android back handler can close it before leaving the tab. */
  panelOpen: boolean;

  hydrate: (proficiencyLevel?: string | null, targetLang?: string | null) => Promise<void>;
  fetchNext: () => Promise<void>;
  setMix: (mix: LevelMix) => Promise<void>;
  setActiveIndex: (index: number) => void;
  setPanelOpen: (open: boolean) => void;
  favourite: (item: FeedItem) => Promise<void>;
  reset: () => void;
}

/** Kept outside the store: these are request parameters, not UI state, and
 *  putting them in state would re-render every card when they resolve. */
let targetLanguage: string | null = null;

/** Fixes the server's shuffle for this launch. Re-minted on hydrate and on
 *  any mix change — both are moments the deck should be dealt again. */
let sessionSeed: string = randomToken();

/** Synchronous re-entry guard for `hydrate`. `hydrated` can't do this job on
 *  its own: it is only set after two awaits, so two callers arriving in the
 *  same tick — App's boot effect and the Explore screen's mount effect — would
 *  both sail past it and fetch page 0 twice. */
let hydrating = false;

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
  page: 0,
  loading: false,
  exhausted: false,
  loadError: false,
  mix: defaultMixForLevel('B1'),
  mixApplied: {},
  activeIndex: 0,
  saved: new Set<number>(),
  hydrated: false,
  panelOpen: false,

  hydrate: async (proficiencyLevel, targetLang) => {
    if (hydrating || get().hydrated) return;
    hydrating = true;

    targetLanguage = targetLang ?? null;
    // A new launch is a new deck.
    sessionSeed = randomToken();

    let mix = defaultMixForLevel(proficiencyLevel);
    try {
      const stored = await AsyncStorage.getItem(MIX_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as LevelMix;
        // Only trust a stored mix that still balances — a partial write or
        // an older shape falls back to the level-derived default.
        if (isBalanced(parsed)) mix = parsed;
      }
    } catch {
      // Fall through to the default.
    }

    // Paint last launch's cards, in a new order, before the request is sent.
    const buffered = await readBuffer();

    set({ mix, items: shuffle(buffered), hydrated: true });
    // `hydrated` is the guard from here on.
    hydrating = false;

    await get().fetchNext();
  },

  fetchNext: async () => {
    const { loading, exhausted, page, mix, items } = get();
    if (loading || exhausted) return;

    set({ loading: true, loadError: false });
    try {
      const res = await srsApi.feed({
        limit: FEED_PAGE_SIZE,
        offset: page * FEED_PAGE_SIZE,
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

      set({
        items: next,
        page: page + 1,
        mixApplied: res.mix_applied ?? {},
        exhausted: !res.has_more,
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

    try {
      await AsyncStorage.setItem(MIX_KEY, JSON.stringify(mix));
    } catch {
      // Persisting is best-effort; the mix still applies this session.
    }

    // The buffer holds the previous mix's levels, so restoring it next
    // launch would contradict the proportions just dialled in. A new seed
    // makes this a genuinely new deck rather than the old one re-cut.
    AsyncStorage.removeItem(BUFFER_KEY).catch(() => {});
    sessionSeed = randomToken();

    // Reset to page 0 so the new proportions are visible immediately
    // rather than after the current page drains.
    set({
      mix,
      items: [],
      page: 0,
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

  setPanelOpen: (open) => set({ panelOpen: open }),

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
      page: 0,
      loading: false,
      exhausted: false,
      loadError: false,
      activeIndex: 0,
      saved: new Set<number>(),
      hydrated: false,
      panelOpen: false,
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

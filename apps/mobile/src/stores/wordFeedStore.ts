/**
 * wordFeedStore — paging + actions for the Explore word feed.
 *
 * Mirrors `reelStore`'s paging shape (optimistic writes, rollback on
 * failure, AsyncStorage for anything that must survive a relaunch). Two
 * pieces of local state outlive the session:
 *
 *   • `mix`  — the CEFR blend the user dialled in (key `feedLevelMix`).
 *   • `seen` — lemma ids already scrolled past, so a passive swipe doesn't
 *              resurface tomorrow. Deliberately client-side: the server has
 *              no FEED_SEEN interaction type and v1 adds no schema.
 *
 * The heart ("Save") is the existing global word save — a `user_words` row
 * with no movie — which is what puts the word in the notebook and the next
 * SRS session. There is no separate favourite column.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { srsApi, wordwiseApi, type FeedItem, type LevelMix } from '../services/api';
import { defaultMixForLevel, isBalanced } from '../utils/levelMix';

const MIX_KEY = 'feedLevelMix';
const SEEN_KEY = 'feedSeenLemmas.v1';

export const FEED_PAGE_SIZE = 20;

/** Prefetch when the user is this many cards from the end. */
export const PREFETCH_THRESHOLD = 2;

/** Cap on the persisted seen-set. Unbounded growth would make every launch
 *  parse a bigger blob for progressively less benefit. */
const SEEN_LIMIT = 2000;

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
  seen: Set<number>;
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

async function persistSeen(seen: Set<number>): Promise<void> {
  // Keep the most recent ids — a Set preserves insertion order, so the tail
  // is the newest.
  const ids = Array.from(seen).slice(-SEEN_LIMIT);
  try {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // A failed write just means the word may reappear — not worth surfacing.
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
  seen: new Set<number>(),
  saved: new Set<number>(),
  hydrated: false,
  panelOpen: false,

  hydrate: async (proficiencyLevel, targetLang) => {
    if (get().hydrated) return;
    targetLanguage = targetLang ?? null;

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

    let seen = new Set<number>();
    try {
      const stored = await AsyncStorage.getItem(SEEN_KEY);
      if (stored) seen = new Set<number>(JSON.parse(stored) as number[]);
    } catch {
      // An unreadable seen-set just means repeats, not a broken feed.
    }

    set({ mix, seen, hydrated: true });
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
      });

      // Drop anything already on screen. The server pages a stable
      // per-day sequence, so this only fires if a page is re-requested,
      // but a duplicate key in a FlatList is worse than a short page.
      const known = new Set(items.map((i) => i.lemma_id));
      const fresh = res.items.filter((i) => !known.has(i.lemma_id));

      set({
        items: [...items, ...fresh],
        page: page + 1,
        mixApplied: res.mix_applied ?? {},
        exhausted: !res.has_more,
        loading: false,
      });
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
    const { items, activeIndex, seen } = get();
    if (index === activeIndex) return;

    const item = items[index];
    if (item && !seen.has(item.lemma_id)) {
      const next = new Set(seen);
      next.add(item.lemma_id);
      set({ activeIndex: index, seen: next });
      persistSeen(next);
      return;
    }
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

  reset: () =>
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
    }),
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

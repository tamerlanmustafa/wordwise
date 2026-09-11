import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReviewSessionStore } from '../reviewSessionStore';
import type { SrsReviewCard, SessionKind } from '../../services/api';

const KEY = 'srs.reviewSession.v2';
const STALE_MS = 24 * 60 * 60 * 1000;
const flush = () => new Promise<void>((r) => setImmediate(r));

const card = (id: number): SrsReviewCard =>
  ({
    user_word_id: id,
    word: `word${id}`,
    movie_id: null,
    movie_title: null,
    srs_box: 1,
    srs_due_at: '2026-06-02T00:00:00Z',
    definition: null,
    example_sentence: null,
    cefr_level: null,
  } as SrsReviewCard);

const session = (
  kind: SessionKind,
  cards: number[],
  scopeId: number | null = null,
  sessionId: number | null = 77,
) => ({
  kind,
  scopeId,
  sessionId,
  remaining: cards.map(card),
  got: 0,
  forgot: 0,
  totalCards: cards.length,
});

describe('reviewSessionStore', () => {
  let nowSpy: jest.SpyInstance;
  let clock = 1_700_000_000_000;

  beforeEach(async () => {
    await AsyncStorage.clear();
    clock = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    useReviewSessionStore.setState({ cached: null, hydrated: false });
  });

  afterEach(() => nowSpy.mockRestore());

  describe('start / persistence', () => {
    it('caches a fresh session and stamps savedAt', () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3]));
      const c = useReviewSessionStore.getState().cached!;
      expect(c.kind).toBe('practice');
      expect(c.remaining).toHaveLength(3);
      expect(c.savedAt).toBe(clock);
    });

    it('writes the session through to AsyncStorage', async () => {
      useReviewSessionStore.getState().start(session('list_films', [1]));
      await flush();
      const raw = await AsyncStorage.getItem(KEY);
      expect(JSON.parse(raw!).kind).toBe('list_films');
    });
  });

  /**
   * The deal id has to survive everything the deck survives.
   *
   * `/srs/session/complete` uses it to clamp the reported counts, to stamp the
   * `local_date` the week strip reads, and to make the completion idempotent —
   * all three are skipped when it arrives null. It used to live only in a ref
   * inside `ReviewScreen`, so quitting mid-deck and finishing it the next
   * morning completed with no id: the day drew as a gap in the strip while the
   * streak counted it, and the tile counter could advance twice on a retry.
   */
  describe('the deal id survives a quit and resume', () => {
    it('round-trips through AsyncStorage', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3], null, 4321));
      await flush();

      // A cold start: nothing in memory, everything from disk.
      useReviewSessionStore.setState({ cached: null, hydrated: false });
      await useReviewSessionStore.getState().hydrate();

      expect(useReviewSessionStore.getState().resumable('practice')!.sessionId).toBe(4321);
    });

    it('is still there after the cards are answered down', () => {
      // `consume` and `skip` rebuild the cached object. The id is carried by
      // the spread, and the completion call happens on the LAST card — i.e.
      // after every one of those rebuilds.
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3], null, 99));
      useReviewSessionStore.getState().consume(true);
      useReviewSessionStore.getState().skip();
      expect(useReviewSessionStore.getState().cached!.sessionId).toBe(99);
    });

    it('reads null for a deck cached before the field existed', async () => {
      // Forward compatibility in the other direction: an install that cached a
      // deck on the previous build must still resume it. The completion falls
      // back to the old unclamped path for that one deck rather than throwing
      // away cards the user already paid for.
      await AsyncStorage.setItem(KEY, JSON.stringify({
        kind: 'practice',
        scopeId: null,
        remaining: [card(1)],
        got: 0,
        forgot: 0,
        totalCards: 1,
        savedAt: clock,
      }));
      await useReviewSessionStore.getState().hydrate();
      const c = useReviewSessionStore.getState().resumable('practice');
      expect(c).not.toBeNull();
      expect(c!.sessionId).toBeNull();
    });
  });

  describe('consume', () => {
    it('drops the head card and increments `got` on a correct answer', () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3]));
      useReviewSessionStore.getState().consume(true);
      const c = useReviewSessionStore.getState().cached!;
      expect(c.remaining.map((r) => r.user_word_id)).toEqual([2, 3]);
      expect(c.got).toBe(1);
      expect(c.forgot).toBe(0);
    });

    it('increments `forgot` on a wrong answer', () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2]));
      useReviewSessionStore.getState().consume(false);
      const c = useReviewSessionStore.getState().cached!;
      expect(c.forgot).toBe(1);
      expect(c.got).toBe(0);
    });

    it('is a no-op when there is no cached session', () => {
      useReviewSessionStore.getState().consume(true);
      expect(useReviewSessionStore.getState().cached).toBeNull();
    });

    it('is a no-op once the deck is exhausted', () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      useReviewSessionStore.getState().consume(true); // empties remaining
      useReviewSessionStore.getState().consume(true); // nothing left
      expect(useReviewSessionStore.getState().cached!.remaining).toHaveLength(0);
      expect(useReviewSessionStore.getState().cached!.got).toBe(1);
    });
  });

  describe('resumable', () => {
    it('returns the cached session when the tile matches and cards remain', () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2]));
      expect(useReviewSessionStore.getState().resumable('practice')).not.toBeNull();
    });

    it('returns null for a different kind', () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      expect(useReviewSessionStore.getState().resumable('list_words')).toBeNull();
    });

    it('matches a list deck only when the list id matches', () => {
      // The list kinds have one deck per list, so quitting list 555 and
      // opening list 999 must draw fresh cards rather than resume 555's.
      useReviewSessionStore.getState().start(session('list_words', [1], 555));
      expect(useReviewSessionStore.getState().resumable('list_words', 555)).not.toBeNull();
      expect(useReviewSessionStore.getState().resumable('list_words', 999)).toBeNull();
    });

    it('resumes practice on kind alone — it has only one deck', () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2]));
      expect(useReviewSessionStore.getState().resumable('practice')).not.toBeNull();
      expect(useReviewSessionStore.getState().resumable('practice', 42)).not.toBeNull();
    });

    it('returns null (and self-heals) for a stale session older than 24h', () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      clock += STALE_MS + 1;
      expect(useReviewSessionStore.getState().resumable('practice')).toBeNull();
      expect(useReviewSessionStore.getState().cached).toBeNull();
    });

    it('returns null when no cards remain', () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      useReviewSessionStore.getState().consume(true);
      expect(useReviewSessionStore.getState().resumable('practice')).toBeNull();
    });
  });

  describe('hydrate', () => {
    it('loads a fresh persisted session', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2]));
      await flush();
      useReviewSessionStore.setState({ cached: null, hydrated: false });
      await useReviewSessionStore.getState().hydrate();
      expect(useReviewSessionStore.getState().cached?.remaining).toHaveLength(2);
      expect(useReviewSessionStore.getState().hydrated).toBe(true);
    });

    it('discards a stale persisted session on hydrate', async () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      await flush();
      clock += STALE_MS + 1;
      useReviewSessionStore.setState({ cached: null, hydrated: false });
      await useReviewSessionStore.getState().hydrate();
      expect(useReviewSessionStore.getState().cached).toBeNull();
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });

    it('hydrates to null when storage holds malformed data', async () => {
      await AsyncStorage.setItem(KEY, '{bad json');
      await useReviewSessionStore.getState().hydrate();
      expect(useReviewSessionStore.getState().cached).toBeNull();
    });
  });

  describe('skip', () => {
    // A card the client cannot render — an unknown `card_type` from a server
    // build ahead of this one — is dropped on the floor so the deck doesn't
    // black-screen. It used to be dropped through `consume(true)`, which
    // scored it: a word the user was never shown was recorded as remembered,
    // pushing it up the Leitner boxes and out to a 30-day interval, and
    // inflating the accuracy on the done screen with a card nobody answered.
    it('drops the head card without scoring it', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3]));
      await flush();
      useReviewSessionStore.getState().skip();
      await flush();

      const c = useReviewSessionStore.getState().cached!;
      expect(c.remaining.map((r) => r.user_word_id)).toEqual([2, 3]);
      expect({ got: c.got, forgot: c.forgot }).toEqual({ got: 0, forgot: 0 });
    });

    it('shrinks the total so the header counts only what was asked', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3]));
      await flush();
      useReviewSessionStore.getState().skip();
      await flush();

      // Three cards drawn, one undrawable: the user is answering two.
      expect(useReviewSessionStore.getState().cached!.totalCards).toBe(2);
    });

    it('persists, so a resume does not resurrect the skipped card', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2]));
      await flush();
      useReviewSessionStore.getState().skip();
      await flush();

      const raw = JSON.parse((await AsyncStorage.getItem(KEY))!);
      expect(raw.remaining.map((r: any) => r.user_word_id)).toEqual([2]);
    });

    it('is a no-op on an empty or absent cache', async () => {
      useReviewSessionStore.getState().clear();
      await flush();
      expect(() => useReviewSessionStore.getState().skip()).not.toThrow();
      expect(useReviewSessionStore.getState().cached).toBeNull();
    });

    it('leaves a score already earned alone', async () => {
      useReviewSessionStore.getState().start(session('practice', [1, 2, 3]));
      await flush();
      useReviewSessionStore.getState().consume(true);
      useReviewSessionStore.getState().skip();
      await flush();

      const c = useReviewSessionStore.getState().cached!;
      expect({ got: c.got, forgot: c.forgot }).toEqual({ got: 1, forgot: 0 });
    });
  });

  describe('clear', () => {
    it('wipes both the in-memory cache and the persisted copy', async () => {
      useReviewSessionStore.getState().start(session('practice', [1]));
      await flush();
      useReviewSessionStore.getState().clear();
      await flush();
      expect(useReviewSessionStore.getState().cached).toBeNull();
      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });
  });
});

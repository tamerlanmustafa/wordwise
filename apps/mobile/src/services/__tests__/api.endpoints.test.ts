// End-to-end-ish coverage of the typed API wrappers. These exercise the real
// authFetch (no token in the SecureStore mock → plain requests, no refresh) so
// the assertions double as a regression guard on request shape + error mapping.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  srsApi,
  reelApi,
  quizApi,
  wordwiseApi,
  reportsApi,
  listsApi,
  SrsPaywallError,
  API_BASE_URL,
} from '../api';

const ok = (body: unknown, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const lastCall = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1];
const urlOf = (m: jest.Mock) => lastCall(m)[0] as string;
const bodyOf = (m: jest.Mock) => JSON.parse(((lastCall(m)[1] || {}) as { body?: string }).body || '{}');
const methodOf = (m: jest.Mock) => ((lastCall(m)[1] || {}) as { method?: string }).method;

describe('API endpoint wrappers', () => {
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  describe('srsApi.startSession', () => {
    it('POSTs to /srs/session/start with the kind query param', async () => {
      fetchMock.mockResolvedValue(ok({ cards: [], total_due: 0, session_size: 0, is_preview: false, previews_remaining: 3 }));
      await srsApi.startSession({ kind: 'list_words' });
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/srs/session/start?kind=list_words`);
      expect(methodOf(fetchMock)).toBe('POST');
    });

    it('never sends a movie_id — practice is not scoped to a film', async () => {
      fetchMock.mockResolvedValue(ok({ cards: [] }));
      await srsApi.startSession({ kind: 'practice' });
      expect(urlOf(fetchMock)).not.toContain('movie_id');
    });

    it('hits the bare endpoint (backend default) when no opts are given', async () => {
      fetchMock.mockResolvedValue(ok({ cards: [] }));
      await srsApi.startSession();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/srs/session/start`);
    });

    it('maps a 402 daily-cap response to SrsPaywallError(daily_cap_reached)', async () => {
      fetchMock.mockResolvedValue(
        ok(
          { detail: { paywall: 'srs_daily_cap_reached', message: 'Come back tomorrow', previews_used: 1, previews_limit: 1 } },
          402,
        ),
      );
      await expect(srsApi.startSession()).rejects.toMatchObject({
        name: 'SrsPaywallError',
        kind: 'daily_cap_reached',
        previews_limit: 1,
      });
    });

    it('maps any other 402 to the preview-exhausted paywall', async () => {
      fetchMock.mockResolvedValue(ok({ detail: { message: 'No previews', previews_used: 3, previews_limit: 3 } }, 402));
      const err = await srsApi.startSession().catch((e) => e);
      expect(err).toBeInstanceOf(SrsPaywallError);
      expect((err as SrsPaywallError).kind).toBe('preview_exhausted');
    });

    it('throws a generic error on a 500', async () => {
      fetchMock.mockResolvedValue(ok({ detail: 'boom' }, 500));
      await expect(srsApi.startSession()).rejects.toThrow(/session\/start/);
    });
  });

  describe('srsApi.review', () => {
    it('POSTs the boolean grade for a word', async () => {
      fetchMock.mockResolvedValue(ok({}, 200));
      await srsApi.review(123, true);
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/srs/review`);
      expect(bodyOf(fetchMock)).toEqual({ user_word_id: 123, correct: true });
    });

    it('throws when the server rejects the grade', async () => {
      fetchMock.mockResolvedValue(ok({}, 400));
      await expect(srsApi.review(1, false)).rejects.toThrow(/srs\/review/);
    });
  });

  describe('srsApi.completeSession', () => {
    it('POSTs the session tally and returns the chest payload', async () => {
      fetchMock.mockResolvedValue(
        ok({ chest: { kind: 'xp_small', label: '+10 XP', payload: { xp: 10 } }, already_claimed: false, correct_count: 8, total_count: 10, streak: 3, unlocked_cosmetics: [] }),
      );
      const res = await srsApi.completeSession(8, 10);
      expect(bodyOf(fetchMock)).toEqual({ correct_count: 8, total_count: 10 });
      expect(res.chest?.kind).toBe('xp_small');
    });
  });

  describe('srsApi.todaysWord', () => {
    it('fetches once then serves the per-hour cache on the next call', async () => {
      fetchMock.mockResolvedValue(ok({ word: 'serendipity', translated_word: null, example_sentence: null, translated_sentence: null, cefr_level: 'C1' }));
      const first = await srsApi.todaysWord(0, 'ES');
      const second = await srsApi.todaysWord(0, 'ES');
      expect(first?.word).toBe('serendipity');
      expect(second?.word).toBe('serendipity');
      expect(fetchMock).toHaveBeenCalledTimes(1); // second served from AsyncStorage
    });

    it('returns null on a non-OK response', async () => {
      fetchMock.mockResolvedValue(ok({}, 404));
      await expect(srsApi.todaysWord(5, 'FR')).resolves.toBeNull();
    });
  });

  // ─── Lists ─────────────────────────────────────────────────────────────
  // All nine wrappers. The mapping assertions matter as much as the request
  // shape: the wire is snake_case and the client is camelCase, so a missed
  // field surfaces as a silently-undefined count rather than a type error.
  describe('listsApi', () => {
    const wireSummary = {
      id: 12,
      name: 'Saved from Home',
      kind: 'films',
      system_key: 'reel',
      count: 5,
      due_count: null,
      total_words: 20424,
      preview: { posters: ['/a.jpg'], words: null },
      updated_at: '2026-08-11T09:14:00Z',
    };

    it('list GETs /lists with no kind filter by default', async () => {
      fetchMock.mockResolvedValue(ok({ lists: [] }));
      await listsApi.list();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists`);
    });

    it('list passes the kind filter through', async () => {
      fetchMock.mockResolvedValue(ok({ lists: [] }));
      await listsApi.list('words');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists?kind=words`);
    });

    it('list maps the wire shape onto camelCase', async () => {
      fetchMock.mockResolvedValue(ok({ lists: [wireSummary] }));
      const [summary] = await listsApi.list();
      expect(summary).toMatchObject({
        id: 12,
        systemKey: 'reel',
        count: 5,
        dueCount: null,
        totalWords: 20424,
      });
      expect(summary.preview.posters).toEqual(['/a.jpg']);
    });

    it('detail GETs the list with limit, cursor and sort', async () => {
      fetchMock.mockResolvedValue(ok({ list: wireSummary, items: [], next_cursor: null }));
      await listsApi.detail(12, { limit: 20, cursor: '40', sort: 'rating' });
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/12?limit=20&cursor=40&sort=rating`);
    });

    it('detail maps film items by the list kind', async () => {
      fetchMock.mockResolvedValue(ok({
        list: wireSummary,
        items: [{
          tmdb_id: 238, title: 'The Godfather', poster_path: '/g.jpg', year: 1972,
          rating: 8.7, cefr: 'B2', word_count: 4218, added_at: '2026-08-11T00:00:00Z',
        }],
        next_cursor: '50',
      }));
      const detail = await listsApi.detail(12);
      expect(detail.items[0]).toMatchObject({ tmdbId: 238, wordCount: 4218, cefr: 'B2' });
      expect(detail.nextCursor).toBe('50');
    });

    it('detail maps word items and defaults an absent SRS state to new', async () => {
      // A word added from Explore and never studied has no user_words row.
      fetchMock.mockResolvedValue(ok({
        list: { ...wireSummary, kind: 'words', system_key: 'favourites' },
        items: [{ word: 'reluctant', lemma_id: 8123, pos: 'adjective', cefr: 'B2', added_at: 'x' }],
        next_cursor: null,
      }));
      const detail = await listsApi.detail(11);
      expect(detail.items[0]).toMatchObject({ word: 'reluctant', lemmaId: 8123, srsState: 'new' });
    });

    it('create POSTs the name and kind', async () => {
      fetchMock.mockResolvedValue(ok({ ...wireSummary, id: 30, system_key: null }, 201));
      await listsApi.create('Film noir night', 'films');
      expect(methodOf(fetchMock)).toBe('POST');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists`);
      expect(bodyOf(fetchMock)).toEqual({ name: 'Film noir night', kind: 'films' });
    });

    it('create surfaces a duplicate name as a coded ListApiError', async () => {
      // The sheet switches on this code to put the message on its name field
      // rather than in a toast.
      fetchMock.mockResolvedValue(
        ok({ detail: { code: 'duplicate_name', message: 'You already have a list with that name' } }, 409),
      );
      await expect(listsApi.create('Film noir', 'films')).rejects.toMatchObject({
        name: 'ListApiError',
        code: 'duplicate_name',
        status: 409,
      });
    });

    it('rename PATCHes just the name', async () => {
      fetchMock.mockResolvedValue(ok(wireSummary));
      await listsApi.rename(30, 'Noir night');
      expect(methodOf(fetchMock)).toBe('PATCH');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/30`);
      expect(bodyOf(fetchMock)).toEqual({ name: 'Noir night' });
    });

    it('rename of a pinned list surfaces the system_list code', async () => {
      fetchMock.mockResolvedValue(
        ok({ detail: { code: 'system_list', message: 'This list cannot be renamed' } }, 409),
      );
      await expect(listsApi.rename(12, 'Nope')).rejects.toMatchObject({ code: 'system_list' });
    });

    it('remove DELETEs the list and tolerates a 204 with no body', async () => {
      fetchMock.mockResolvedValue({ status: 204, ok: true, json: async () => { throw new Error('no body'); } });
      await expect(listsApi.remove(30)).resolves.toBeUndefined();
      expect(methodOf(fetchMock)).toBe('DELETE');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/30`);
    });

    it('addItems POSTs a batch in one request', async () => {
      fetchMock.mockResolvedValue(ok(wireSummary));
      await listsApi.addItems(30, {
        films: [
          { tmdb_id: 238, title: 'The Godfather', poster_path: '/g.jpg', year: 1972 },
          { tmdb_id: 240, title: 'Part II', poster_path: null, year: 1974 },
        ],
      });
      expect(methodOf(fetchMock)).toBe('POST');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/30/items`);
      expect(bodyOf(fetchMock).films).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('removeItem DELETEs by tmdb id for films', async () => {
      fetchMock.mockResolvedValue({ status: 204, ok: true, json: async () => undefined });
      await listsApi.removeItem(30, 238);
      expect(methodOf(fetchMock)).toBe('DELETE');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/30/items/238`);
    });

    it('removeItem URL-encodes a word key', async () => {
      // Multi-word lemmas exist; an unescaped space would 404.
      fetchMock.mockResolvedValue({ status: 204, ok: true, json: async () => undefined });
      await listsApi.removeItem(11, 'give up');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/11/items/give%20up`);
    });

    it('reorder PUTs the id order', async () => {
      fetchMock.mockResolvedValue({ status: 204, ok: true, json: async () => undefined });
      await listsApi.reorder([12, 9, 30]);
      expect(methodOf(fetchMock)).toBe('PUT');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/order`);
      expect(bodyOf(fetchMock)).toEqual({ ids: [12, 9, 30] });
    });

    it('practice POSTs and returns the standard session payload', async () => {
      fetchMock.mockResolvedValue(ok({
        cards: [{ user_word_id: 1 }], total_due: 6, session_size: 10,
        is_preview: false, previews_remaining: 0, kind: 'list_words',
      }));
      const session = await listsApi.practice(11);
      expect(methodOf(fetchMock)).toBe('POST');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/lists/11/practice`);
      expect(session.kind).toBe('list_words');
    });

    it('practice maps the free-tier daily cap to SrsPaywallError', async () => {
      // Same cap as the Practice tab — a list is not a way around it.
      fetchMock.mockResolvedValue(
        ok({ detail: { paywall: 'srs_daily_cap_reached', message: 'Tomorrow', previews_used: 1, previews_limit: 1 } }, 402),
      );
      await expect(listsApi.practice(11)).rejects.toMatchObject({
        name: 'SrsPaywallError',
        kind: 'daily_cap_reached',
      });
    });

    it('practice surfaces an empty pool as nothing_to_practice', async () => {
      fetchMock.mockResolvedValue(
        ok({ detail: { code: 'nothing_to_practice', message: "There's nothing to practise in this list yet" } }, 409),
      );
      await expect(listsApi.practice(30)).rejects.toMatchObject({ code: 'nothing_to_practice' });
    });
  });

  describe('reelApi', () => {
    it('list GETs /reel with cursor + limit', async () => {
      fetchMock.mockResolvedValue(ok({ tiles: [], has_more: false }));
      await reelApi.list();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/reel?cursor=0&limit=60`);
    });

    it('add POSTs the movie payload', async () => {
      fetchMock.mockResolvedValue(ok({ tmdb_id: 7, title: 'Heat', poster_path: null, year: 1995, source: 'user' }));
      await reelApi.add({ tmdb_id: 7, title: 'Heat', poster_path: null, year: 1995 });
      expect(methodOf(fetchMock)).toBe('POST');
      expect(bodyOf(fetchMock)).toMatchObject({ tmdb_id: 7, title: 'Heat' });
    });

    it('remove DELETEs /reel/:id and tolerates a 204', async () => {
      fetchMock.mockResolvedValue(ok(null, 204));
      await expect(reelApi.remove(7)).resolves.toBeUndefined();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/reel/7`);
      expect(methodOf(fetchMock)).toBe('DELETE');
    });

    it('seed POSTs /reel/seed', async () => {
      fetchMock.mockResolvedValue(ok({ seeded: 5, tiles: [] }));
      await reelApi.seed();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/reel/seed`);
    });
  });

  describe('quizApi', () => {
    it('startSession POSTs movie_id/level/kind', async () => {
      fetchMock.mockResolvedValue(ok({ session_id: 1, cards: [] }));
      await quizApi.startSession(10, 'B1', 'unit');
      expect(bodyOf(fetchMock)).toEqual({ movie_id: 10, level: 'B1', kind: 'unit' });
    });

    it('submitCards POSTs the per-card results array', async () => {
      fetchMock.mockResolvedValue(ok({ stored: 2 }));
      const results = [
        { word: 'a', card_type: 'mcq' as const, is_correct: true, self_rating: null, answer_ms: 800 },
      ];
      await quizApi.submitCards(99, results);
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/quiz/sessions/99/cards`);
      expect(bodyOf(fetchMock)).toEqual({ results });
    });

    it('startBatchSession surfaces the server detail message on failure', async () => {
      fetchMock.mockResolvedValue(ok({ detail: 'Need at least 2 movies' }, 400));
      await expect(quizApi.startBatchSession([1], 'A2')).rejects.toThrow('Need at least 2 movies');
    });
  });

  describe('wordwiseApi', () => {
    it('getMoviesByCefr builds the level/limit/offset/sort/order query', async () => {
      fetchMock.mockResolvedValue(ok({ level: 'B1', total: 0, offset: 0, has_more: false, movies: [] }));
      await wordwiseApi.getMoviesByCefr('B1', 10, { offset: 20, sort: 'rating', order: 'desc' });
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/movies/by-cefr?level=B1&limit=10&offset=20&sort=rating&order=desc`);
    });

    it('getMoviesByCefr omits `animated` unless the filter is on (#114)', async () => {
      fetchMock.mockResolvedValue(ok({ level: 'B1', total: 0, offset: 0, has_more: false, movies: [] }));
      await wordwiseApi.getMoviesByCefr('B1', 10, { offset: 0, sort: 'rating', order: 'desc' });
      expect(urlOf(fetchMock)).not.toContain('animated');
    });

    it('getMoviesByCefr sends animated=false for the live-action filter', async () => {
      // The bug this pins: a truthiness check would swallow `false` and quietly
      // serve the unfiltered feed while the chip claimed "Live action".
      fetchMock.mockResolvedValue(ok({ level: 'B1', total: 0, offset: 0, has_more: false, movies: [] }));
      await wordwiseApi.getMoviesByCefr('B1', 10, { offset: 0, sort: 'rating', order: 'desc', animated: false });
      expect(urlOf(fetchMock)).toContain('&animated=false');
    });

    it('getMoviesByCefr sends animated=true for the animation filter', async () => {
      fetchMock.mockResolvedValue(ok({ level: 'A1', total: 0, offset: 0, has_more: false, movies: [] }));
      await wordwiseApi.getMoviesByCefr('A1', 10, { animated: true });
      expect(urlOf(fetchMock)).toContain('&animated=true');
    });

    it('getMoviesByCefr sends the recommendation seed when paging a draw', async () => {
      fetchMock.mockResolvedValue(ok({ level: 'B1', total: 0, offset: 0, has_more: false, movies: [] }));
      await wordwiseApi.getMoviesByCefr('B1', 10, { offset: 10, sort: 'recommended', seed: 82798 });
      expect(urlOf(fetchMock)).toContain('&seed=82798');
    });

    // A new build talking to an API that has not deployed yet. This happened
    // for real: the OTA reached phones minutes before Railway finished, the
    // old server 400'd on the unknown sort, and the feed renders a failed
    // fetch as "no classified movies found" — so Home went blank, not
    // degraded. One retry on a sort every version of the endpoint accepts.
    it('getMoviesByCefr falls back to rating when the API rejects `recommended`', async () => {
      fetchMock
        .mockResolvedValueOnce(ok('Invalid sort: recommended', 400))
        .mockResolvedValueOnce(ok({ level: 'B1', total: 1, offset: 0, has_more: false, movies: [{ movie_id: 1 }] }));

      const res = await wordwiseApi.getMoviesByCefr('B1', 10, { sort: 'recommended' });

      expect(res.movies).toHaveLength(1);
      expect(urlOf(fetchMock)).toContain('sort=rating');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('getMoviesByCefr does not retry a 400 on the column sorts', async () => {
      fetchMock.mockResolvedValue(ok('Invalid CEFR level: ZZ', 400));
      await expect(
        wordwiseApi.getMoviesByCefr('ZZ', 10, { sort: 'rating' }),
      ).rejects.toThrow(/by-cefr → 400/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('getMoviesByCefr does not retry a 5xx — that is a server in trouble', async () => {
      // Retrying with different params would hide the outage behind a feed
      // that looks fine, which is worse than an error the user can retry.
      fetchMock.mockResolvedValue(ok('upstream exploded', 503));
      await expect(
        wordwiseApi.getMoviesByCefr('B1', 10, { sort: 'recommended' }),
      ).rejects.toThrow(/by-cefr → 503/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('getMoviesByLevel sends the learner CEFR band onboarding actually holds', async () => {
      // #103: onboarding's "pick your first film" passes startingLevel, a CEFR
      // code. The endpoint used to validate against the retired long-name enum
      // and 400, so every new user got an empty suggestion list.
      fetchMock.mockResolvedValue(ok({ level: 'A1', total: 0, movies: [] }));
      await wordwiseApi.getMoviesByLevel('A1', 12);
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/movies/by-level?level=A1&limit=12`);
    });

    it('searchMovies URL-encodes the query', async () => {
      fetchMock.mockResolvedValue(ok({ query: 'die hard', results: [], total: 0, tmdb_metadata: null }));
      await wordwiseApi.searchMovies('die hard');
      expect(urlOf(fetchMock)).toContain('query=die%20hard');
    });

    it('getMoviesByCefr throws a descriptive error on failure', async () => {
      fetchMock.mockResolvedValue(ok('upstream exploded', 502));
      await expect(wordwiseApi.getMoviesByCefr('B1')).rejects.toThrow(/by-cefr → 502/);
    });

    it('translate sends the context sentence so the word resolves in-context', async () => {
      fetchMock.mockResolvedValue(ok({ source: 'run', translated: 'dirigir', target_lang: 'ES', cached: false }));
      await wordwiseApi.translate('run', 'ES', undefined, 42, 'They run a small business.');
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/translate`);
      expect(bodyOf(fetchMock)).toMatchObject({
        text: 'run',
        target_lang: 'ES',
        movie_id: 42,
        sentence: 'They run a small business.',
      });
    });

    it('translate omits sentence/movie_id when not given', async () => {
      fetchMock.mockResolvedValue(ok({ source: 'run', translated: 'correr', target_lang: 'ES', cached: false }));
      await wordwiseApi.translate('run', 'ES');
      const body = bodyOf(fetchMock);
      expect(body).not.toHaveProperty('sentence');
      expect(body).not.toHaveProperty('movie_id');
    });
  });

  describe('reportsApi.create', () => {
    it('POSTs a new word report', async () => {
      fetchMock.mockResolvedValue(ok({ success: true, report_id: 5 }));
      await reportsApi.create({ word: 'cromulent', reason: 'WRONG_TRANSLATION' });
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/api/reports/`);
      expect(bodyOf(fetchMock)).toMatchObject({ word: 'cromulent', reason: 'WRONG_TRANSLATION' });
    });
  });
});

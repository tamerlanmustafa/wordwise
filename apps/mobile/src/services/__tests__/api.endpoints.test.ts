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
    it('POSTs to /srs/session/start with the kind + movie_id query params', async () => {
      fetchMock.mockResolvedValue(ok({ cards: [], total_due: 0, session_size: 0, is_preview: false, previews_remaining: 3 }));
      await srsApi.startSession({ kind: 'movie_deep_dive', movieId: 42 });
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/srs/session/start?kind=movie_deep_dive&movie_id=42`);
      expect(methodOf(fetchMock)).toBe('POST');
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

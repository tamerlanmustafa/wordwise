// Opening a movie used to be three sequential network stages, the middle one
// being /api/cefr/classify-script — whose response the screen throws away and
// which, for an already-classified movie, only re-reads what /vocabulary/full
// is about to return anyway (issue #122).
//
// What matters here: an already-classified movie must not make the user wait
// for that call, a never-classified one still must (nothing to return until it
// finishes), and the classify side effects must keep happening either way.
jest.mock('../auth/tokenStorage', () => ({
  tokenStorage: {
    getAccessToken: jest.fn(async () => 'access-token'),
    getRefreshToken: jest.fn(async () => 'refresh-token'),
    saveTokens: jest.fn(async () => {}),
    clearTokens: jest.fn(async () => {}),
  },
}));

import { wordwiseApi } from '../api';
import { fetchMovieVocabulary } from '../movieVocabulary';

const VOCAB = {
  movie_id: 42,
  total_words: 10,
  unique_words: 10,
  level_distribution: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1, C2: 1 },
  average_confidence: 0.9,
  wordlist_coverage: 0,
  top_words_by_level: {},
} as never;

const script = (over: Record<string, unknown> = {}) => ({
  script_id: 1,
  movie_id: 42,
  source_used: 'SUBTITLE_SRT',
  cleaned_text: 'a real script',
  word_count: 5000,
  is_complete: true,
  is_truncated: false,
  from_cache: true,
  metadata: { title: 'Heat' },
  fetched_at: null,
  ...over,
});

/** A promise that never settles — stands in for a slow classify call. */
const never = () => new Promise<never>(() => {});

const flush = () => Promise.resolve();

describe('fetchMovieVocabulary', () => {
  let fetchScript: jest.SpyInstance;
  let classify: jest.SpyInstance;
  let vocabFull: jest.SpyInstance;
  let vocabPreview: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.restoreAllMocks();
    fetchScript = jest.spyOn(wordwiseApi, 'fetchScript').mockResolvedValue(script() as never);
    classify = jest.spyOn(wordwiseApi, 'classifyVocabulary').mockResolvedValue(VOCAB);
    vocabFull = jest.spyOn(wordwiseApi, 'getVocabularyFull').mockResolvedValue(VOCAB);
    vocabPreview = jest.spyOn(wordwiseApi, 'getVocabularyPreview').mockResolvedValue(VOCAB);

    // The bare fetch() used for /difficulty.
    fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ difficulty_level: 'B1', difficulty_score: 55 }),
    }));
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('does not wait for classify when the movie is already classified', async () => {
    // If the open path awaited this, the whole call would hang forever.
    classify.mockImplementation(never);
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);

    const result = await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(result).toEqual({ status: 'ok', vocab: VOCAB, movieId: 42, difficulty: { level: 'B1', score: 55 } });
    expect(vocabFull).toHaveBeenCalledWith(42);
  });

  it('still fires classify for its side effects when it skips waiting', async () => {
    // It backfills difficulty/genre and tops up the sentence bank — dropping
    // it entirely would quietly stop both.
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);

    await fetchMovieVocabulary({ title: 'Heat', targetLang: 'FR', genreNames: ['Crime'] });

    expect(classify).toHaveBeenCalledWith(42, 'FR', ['Crime']);
  });

  it('swallows a failing background classify rather than failing the open', async () => {
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);
    classify.mockRejectedValue(new Error('500'));

    await expect(
      fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' }),
    ).resolves.toMatchObject({ status: 'ok' });
    await flush();
  });

  it('waits for classify when the movie has never been classified', async () => {
    let classified = false;
    classify.mockImplementation(async () => {
      classified = true;
      return VOCAB;
    });
    vocabFull.mockImplementation(async () => {
      // The ordering that matters: vocabulary is only asked for once
      // classification exists, otherwise it has nothing to return.
      expect(classified).toBe(true);
      return VOCAB;
    });
    fetchScript.mockResolvedValue(script({ is_classified: false }) as never);

    await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(classify).toHaveBeenCalled();
    expect(vocabFull).toHaveBeenCalled();
  });

  it('treats a backend that omits is_classified as not classified', async () => {
    // Old backend, new app: the safe reading is the slower sequential path.
    let classified = false;
    classify.mockImplementation(async () => {
      classified = true;
      return VOCAB;
    });
    vocabFull.mockImplementation(async () => {
      expect(classified).toBe(true);
      return VOCAB;
    });

    await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(classify).toHaveBeenCalled();
  });

  it('rejects a script too short to teach from, before classifying anything', async () => {
    fetchScript.mockResolvedValue(script({ word_count: 12 }) as never);

    const result = await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(result).toEqual({ status: 'script_too_short' });
    expect(classify).not.toHaveBeenCalled();
    expect(vocabFull).not.toHaveBeenCalled();
  });

  it('rejects a script with no text at all', async () => {
    fetchScript.mockResolvedValue(script({ cleaned_text: '', word_count: 9000 }) as never);

    expect(await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' })).toEqual({
      status: 'script_too_short',
    });
  });

  it('falls back to the public preview when the full vocabulary fails', async () => {
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);
    vocabFull.mockRejectedValue(new Error('401'));

    const result = await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(vocabPreview).toHaveBeenCalledWith(42);
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('returns null difficulty rather than failing when /difficulty is down', async () => {
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);
    fetchMock.mockRejectedValue(new Error('network'));

    const result = await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    expect(result).toMatchObject({ status: 'ok', difficulty: null });
  });

  it('reads difficulty and vocabulary in parallel, not one after the other', async () => {
    fetchScript.mockResolvedValue(script({ is_classified: true }) as never);

    const order: string[] = [];
    let releaseDifficulty: () => void = () => {};
    fetchMock.mockImplementation(async () => {
      order.push('difficulty:start');
      await new Promise<void>((r) => {
        releaseDifficulty = r;
      });
      return { ok: true, json: async () => ({ difficulty_level: 'B1', difficulty_score: 55 }) };
    });
    vocabFull.mockImplementation(async () => {
      order.push('vocab:start');
      releaseDifficulty();
      return VOCAB;
    });

    await fetchMovieVocabulary({ title: 'Heat', targetLang: 'ES' });

    // vocab started while difficulty was still in flight.
    expect(order).toEqual(['difficulty:start', 'vocab:start']);
  });
});

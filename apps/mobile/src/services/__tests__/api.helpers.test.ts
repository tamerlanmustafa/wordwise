import {
  enrichMoviesWithTmdb,
  tmdbApi,
  SrsPaywallError,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  KIND_UNLOCK_THRESHOLDS,
} from '../api';

describe('tmdbApi.getPosterUrl', () => {
  it('returns null for a null poster path', () => {
    expect(tmdbApi.getPosterUrl(null)).toBeNull();
  });

  it('builds a w300 URL by default', () => {
    expect(tmdbApi.getPosterUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg');
  });

  it('honours an explicit size', () => {
    expect(tmdbApi.getPosterUrl('/abc.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
  });
});

describe('enrichMoviesWithTmdb', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('merges TMDB poster/backdrop/overview/release_date onto each row', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        overview: 'A heist drama.',
        poster_path: '/poster.jpg',
        backdrop_path: '/backdrop.jpg',
        release_date: '1995-12-15',
      }),
    });

    const [out] = await enrichMoviesWithTmdb([{ tmdb_id: 949, description: 'old', year: 1995 }]);

    expect(out).toMatchObject({
      overview: 'A heist drama.',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      release_date: '1995-12-15',
    });
  });

  it('leaves a row without a tmdb_id untouched and makes no request', async () => {
    const input = [{ description: 'no tmdb id' }];
    const [out] = await enrichMoviesWithTmdb(input);
    expect(out).toBe(input[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the original row when the TMDB lookup throws', async () => {
    fetchMock.mockRejectedValue(new Error('TMDB down'));
    const input = [{ tmdb_id: 1, description: 'keep me' }];
    const [out] = await enrichMoviesWithTmdb(input);
    expect(out).toEqual(input[0]);
  });

  it('synthesizes release_date from the row year when TMDB omits it', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ overview: '', poster_path: null }) });
    const [out] = await enrichMoviesWithTmdb([{ tmdb_id: 1, year: 2001 }]);
    expect((out as unknown as { release_date: string }).release_date).toBe('2001-01-01');
  });

  it('enriches a whole page in parallel, isolating one failure from the rest', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({ overview: 'ok', poster_path: '/a.jpg' }) })
      .mockRejectedValueOnce(new Error('boom'));
    const out = await enrichMoviesWithTmdb([
      { tmdb_id: 1, description: 'first' },
      { tmdb_id: 2, description: 'second' },
    ]);
    expect((out[0] as unknown as { overview: string }).overview).toBe('ok');
    expect(out[1]).toMatchObject({ description: 'second' }); // fell back
  });
});

describe('SrsPaywallError', () => {
  it('defaults to the preview-exhausted kind', () => {
    const err = new SrsPaywallError('no previews left', 3, 3);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SrsPaywallError');
    expect(err.kind).toBe('preview_exhausted');
    expect(err.previews_used).toBe(3);
    expect(err.previews_limit).toBe(3);
  });

  it('carries the daily-cap kind when specified', () => {
    const err = new SrsPaywallError('come back tomorrow', 1, 1, 'daily_cap_reached');
    expect(err.kind).toBe('daily_cap_reached');
  });
});

describe('label / threshold maps', () => {
  it('has a label for every report reason', () => {
    (['WRONG_TRANSLATION', 'WRONG_CONTEXT', 'WRONG_SPELLING', 'INAPPROPRIATE_CONTENT', 'OTHER'] as const).forEach(
      (r) => expect(REPORT_REASON_LABELS[r]).toBeTruthy(),
    );
  });

  it('has a label for every report status', () => {
    (['PENDING', 'REVIEWED', 'RESOLVED', 'DISMISSED'] as const).forEach((s) =>
      expect(REPORT_STATUS_LABELS[s]).toBeTruthy(),
    );
  });

  it('KIND_UNLOCK_THRESHOLDS exposes every session kind at the post-v0.7.3 zero gate', () => {
    expect(KIND_UNLOCK_THRESHOLDS).toEqual({
      quick_recall: 0,
      tough_words: 0,
      movie_deep_dive: 0,
    });
  });
});

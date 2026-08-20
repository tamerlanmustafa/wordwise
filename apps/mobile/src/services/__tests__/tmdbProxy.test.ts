/**
 * The client half of issue #125.
 *
 * Before: every movie card fetched api.themoviedb.org itself, with a key
 * compiled into the bundle. A 20-row page was 20 round trips from the phone.
 * After: one request to our backend for the whole page, no key in the app.
 *
 * These tests pin the two properties that are easy to regress — that no URL
 * leaves the app pointing at TMDB, and that per-movie lookups made close
 * together really do coalesce into one request.
 */
import { enrichMoviesWithTmdb, tmdbApi } from '../api';

const detailsBody = (ids: number[]) => ({
  movies: Object.fromEntries(
    ids.map((id) => [
      String(id),
      {
        id,
        title: `Movie ${id}`,
        overview: `Overview ${id}`,
        poster_path: `/p${id}.jpg`,
        backdrop_path: `/b${id}.jpg`,
        release_date: '1999-10-15',
        vote_average: 8.4,
        genre_ids: [18],
      },
    ]),
  ),
});

const listBody = () => ({
  page: 1,
  total_pages: 3,
  results: [{ id: 680, title: 'Pulp Fiction', poster_path: '/pf.jpg', genre_ids: [53] }],
});

let fetchMock: jest.Mock;

/** Every URL the code under test asked for. */
const requestedUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  tmdbApi._resetTmdbCache();
  fetchMock = jest.fn();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe('no TMDB traffic leaves the device', () => {
  it('routes every metadata call through our own API', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/movies?ids=')) return ok(detailsBody([1]));
      return ok(listBody());
    });

    await tmdbApi.getTrending();
    await tmdbApi.searchMovies('pulp');
    await tmdbApi.searchMoviesPaged('pulp', 2);
    await tmdbApi.discoverByGenre('28|12', 1);
    await tmdbApi.getMovieDetails(1);

    const urls = requestedUrls();
    expect(urls).toHaveLength(5);
    urls.forEach((url) => {
      expect(url).not.toContain('api.themoviedb.org');
      expect(url).not.toContain('api_key');
      expect(url).toContain('/api/tmdb/');
    });
  });

  it('still builds image URLs client-side (image.tmdb.org needs no key)', () => {
    expect(tmdbApi.getPosterUrl('/abc.jpg', 'w185')).toBe(
      'https://image.tmdb.org/t/p/w185/abc.jpg',
    );
  });
});

describe('per-movie lookups coalesce into one request', () => {
  it('sends one request for a whole page of ids', async () => {
    fetchMock.mockImplementation(async () => ok(detailsBody([1, 2, 3])));

    const out = await Promise.all([1, 2, 3].map((id) => tmdbApi.getMovieDetails(id)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrls()[0]).toContain('/api/tmdb/movies?ids=1,2,3');
    expect(out.map((m) => m?.title)).toEqual(['Movie 1', 'Movie 2', 'Movie 3']);
  });

  it('asks for each id once, however many rows request it', async () => {
    fetchMock.mockImplementation(async () => ok(detailsBody([7])));

    await Promise.all([7, 7, 7].map((id) => tmdbApi.getMovieDetails(id)));

    expect(requestedUrls()[0]).toContain('ids=7');
    expect(requestedUrls()[0]).not.toContain('ids=7,7');
  });

  it('serves a repeat lookup from memory without a second request', async () => {
    fetchMock.mockImplementation(async () => ok(detailsBody([1])));

    await tmdbApi.getMovieDetails(1);
    await tmdbApi.getMovieDetails(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers an id TMDB does not know, instead of re-asking every render', async () => {
    fetchMock.mockImplementation(async () => ok({ movies: {} }));

    expect(await tmdbApi.getMovieDetails(999)).toBeNull();
    expect(await tmdbApi.getMovieDetails(999)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('splits a batch larger than the endpoint accepts', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    fetchMock.mockImplementation(async () => ok(detailsBody(ids)));

    await Promise.all(ids.map((id) => tmdbApi.getMovieDetails(id)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls()[0].split(',')).toHaveLength(40);
  });

  it('throws when the proxy itself errors, so callers can fall back', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    await expect(tmdbApi.getMovieDetails(1)).rejects.toThrow('TMDB proxy 502');
  });
});

describe('enrichMoviesWithTmdb', () => {
  it('enriches a page with a single request', async () => {
    fetchMock.mockImplementation(async () => ok(detailsBody([1, 2])));

    const out = await enrichMoviesWithTmdb([
      { tmdb_id: 1, description: 'old', year: 1995 },
      { tmdb_id: 2, description: 'old', year: 1996 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out[0]).toMatchObject({ overview: 'Overview 1', poster_path: '/p1.jpg' });
    expect(out[1]).toMatchObject({ overview: 'Overview 2', backdrop_path: '/b2.jpg' });
  });

  it('keeps the original row when the proxy is down', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });

    const input = [{ tmdb_id: 1, description: 'keep me' }];
    expect(await enrichMoviesWithTmdb(input)).toEqual(input);
  });

  it('keeps the original row for an id TMDB has retired', async () => {
    fetchMock.mockImplementation(async () => ok({ movies: {} }));

    const input = [{ tmdb_id: 999, description: 'keep me' }];
    expect(await enrichMoviesWithTmdb(input)).toEqual(input);
  });

  it('makes no request at all for rows without a tmdb_id', async () => {
    const input = [{ description: 'no tmdb id' }];
    const [out] = await enrichMoviesWithTmdb(input);

    expect(out).toBe(input[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('synthesizes release_date from the row year when TMDB omits it', async () => {
    fetchMock.mockImplementation(async () =>
      ok({ movies: { '1': { id: 1, overview: '', poster_path: null } } }),
    );

    const [out] = await enrichMoviesWithTmdb([{ tmdb_id: 1, year: 2001 }]);
    expect((out as unknown as { release_date: string }).release_date).toBe('2001-01-01');
  });
});

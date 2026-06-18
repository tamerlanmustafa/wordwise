// classify-script requires an authenticated user, so classifyVocabulary must
// go through authFetch and attach the bearer token. This regression-guards the
// bug where it used a bare fetch() with no Authorization header → 401 for every
// logged-in user. We mock tokenStorage so authFetch has a token to attach.
jest.mock('../auth/tokenStorage', () => ({
  tokenStorage: {
    getAccessToken: jest.fn(async () => 'access-token'),
    getRefreshToken: jest.fn(async () => 'refresh-token'),
    saveTokens: jest.fn(async () => {}),
    clearTokens: jest.fn(async () => {}),
  },
}));

import { wordwiseApi, API_BASE_URL } from '../api';

const ok = (body: unknown, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const lastCall = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1];

describe('wordwiseApi.classifyVocabulary', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('POSTs to /api/cefr/classify-script with the bearer token attached', async () => {
    fetchMock.mockResolvedValue(ok({ level_distribution: {}, top_words_by_level: {} }));

    await wordwiseApi.classifyVocabulary(42, 'FR', ['Drama', 'Crime']);

    const [url, opts] = lastCall(fetchMock) as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(`${API_BASE_URL}/api/cefr/classify-script`);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer access-token');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({
      movie_id: 42,
      save_to_db: true,
      target_language: 'FR',
      genres: ['Drama', 'Crime'],
    });
  });

  it('omits the genres field when none are provided', async () => {
    fetchMock.mockResolvedValue(ok({ level_distribution: {}, top_words_by_level: {} }));

    await wordwiseApi.classifyVocabulary(7);

    const body = JSON.parse((lastCall(fetchMock)[1] as { body: string }).body);
    expect(body).toEqual({ movie_id: 7, save_to_db: true, target_language: 'ES' });
    expect(body).not.toHaveProperty('genres');
  });

  it('throws when the server rejects the request', async () => {
    fetchMock.mockResolvedValue(ok({ detail: 'nope' }, 403));
    await expect(wordwiseApi.classifyVocabulary(1)).rejects.toThrow('Failed to classify vocabulary');
  });
});

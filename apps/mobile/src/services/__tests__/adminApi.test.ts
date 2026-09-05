// The admin API wrappers, after the screen was split into pages.
//
// Admin used to be one page backed by one call. `/admin/stats` answered every
// question the screen could ask — including a CEFR word split over a
// multi-million-row table — so opening admin cost 5,487 ms p95 on prod even if
// you only wanted the queue count. Each section now has its own endpoint and
// fetches when opened, and the two assertions that matter are that each
// wrapper hits its own path and that the expensive report is only recomputed
// when explicitly asked for.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { adminApi, API_BASE_URL } from '../api';

const ok = (body: unknown, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const urlOf = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1][0] as string;

describe('adminApi', () => {
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    await AsyncStorage.clear();
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  describe('one endpoint per page', () => {
    it.each([
      ['overview', '/admin/overview'],
      ['films', '/admin/films'],
      ['words', '/admin/words'],
      ['users', '/admin/users'],
      ['workers', '/admin/workers'],
    ] as const)('%s hits %s', async (method, path) => {
      fetchMock.mockResolvedValue(ok({}));
      await adminApi[method]();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}${path}`);
    });

    it('makes exactly one request per page', async () => {
      fetchMock.mockResolvedValue(ok({}));
      await adminApi.words();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('names the endpoint in the error, so a failing page says which one', async () => {
      fetchMock.mockResolvedValue(ok({ detail: 'nope' }, 500));
      await expect(adminApi.workers()).rejects.toThrow('/admin/workers');
    });
  });

  describe('vocabCoverage', () => {
    it('reads the stored snapshot by default', async () => {
      fetchMock.mockResolvedValue(ok({ metrics: [] }));
      await adminApi.vocabCoverage();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/admin/health/vocab-coverage`);
    });

    it('asks for a recount only when told to', async () => {
      // The recount is ~5s of serial counting over the biggest tables we have.
      // Sending it by default would put the slow path back on the open path.
      fetchMock.mockResolvedValue(ok({ metrics: [] }));
      await adminApi.vocabCoverage({ fresh: true });
      expect(urlOf(fetchMock)).toContain('fresh=1');
    });

    it('treats an explicit fresh:false as the default', async () => {
      fetchMock.mockResolvedValue(ok({ metrics: [] }));
      await adminApi.vocabCoverage({ fresh: false });
      expect(urlOf(fetchMock)).not.toContain('fresh');
    });
  });

  describe('/admin/stats', () => {
    it('still exists for builds that predate the split', async () => {
      // A mobile app is not a browser tab you can reload out from under
      // somebody. An install from last month still calls this on open.
      fetchMock.mockResolvedValue(ok({ movies_total: 0 }));
      await adminApi.stats();
      expect(urlOf(fetchMock)).toBe(`${API_BASE_URL}/admin/stats`);
    });
  });
});

// Stateful tokenStorage mock so the post-refresh retry actually picks up the
// new access token (authFetch re-reads getAccessToken on retry).
jest.mock('../auth/tokenStorage', () => {
  const state = { access: 'old-token' as string | null, refresh: 'refresh-token' as string | null };
  return {
    tokenStorage: {
      getAccessToken: jest.fn(async () => state.access),
      getRefreshToken: jest.fn(async () => state.refresh),
      saveTokens: jest.fn(async (a: string, r: string) => {
        state.access = a;
        state.refresh = r;
      }),
      clearTokens: jest.fn(async () => {
        state.access = null;
        state.refresh = null;
      }),
      __set: (a: string | null, r: string | null) => {
        state.access = a;
        state.refresh = r;
      },
    },
  };
});

import { authFetch, setOnSessionExpired, API_BASE_URL } from '../api';
import { tokenStorage } from '../auth/tokenStorage';

const REFRESH_URL = `${API_BASE_URL}/auth/refresh`;
const PROTECTED_URL = `${API_BASE_URL}/srs/stats`;

const json = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const authHeaderOf = (call: unknown[]): string | undefined => {
  const opts = call[1] as { headers?: Record<string, string> };
  return opts?.headers?.Authorization;
};

describe('authFetch — auth header + transparent token refresh', () => {
  let fetchMock: jest.Mock;
  let onExpired: jest.Mock;

  beforeEach(() => {
    (tokenStorage as unknown as { __set: (a: string | null, r: string | null) => void }).__set(
      'old-token',
      'refresh-token',
    );
    jest.clearAllMocks();
    onExpired = jest.fn();
    setOnSessionExpired(onExpired);
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('attaches the bearer token and JSON content-type', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await authFetch(PROTECTED_URL);
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers.Authorization).toBe('Bearer old-token');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('omits Authorization when there is no token', async () => {
    (tokenStorage as unknown as { __set: (a: string | null, r: string | null) => void }).__set(null, null);
    fetchMock.mockResolvedValue(json(200, {}));
    await authFetch(PROTECTED_URL);
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBeUndefined();
  });

  it('passes a 200 straight through without refreshing', async () => {
    fetchMock.mockResolvedValue(json(200, { hello: 'world' }));
    const res = await authFetch(PROTECTED_URL);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no /auth/refresh
  });

  it('on a 401, refreshes the token and retries the request once', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === REFRESH_URL) return json(200, { token: 'new-token', refresh_token: 'new-refresh' });
      // First protected call 401s; the retry (now carrying new-token) succeeds.
      const tokenUsed = (fetchMock.mock.calls.find((c) => c[0] === url && authHeaderOf(c) === 'Bearer new-token'));
      return tokenUsed ? json(200, { ok: true }) : json(401, { detail: 'expired' });
    });

    const res = await authFetch(PROTECTED_URL);

    expect(res.status).toBe(200);
    expect(tokenStorage.saveTokens).toHaveBeenCalledWith('new-token', 'new-refresh');
    // initial 401 + refresh + successful retry = 3 fetches.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retried = fetchMock.mock.calls[2];
    expect(authHeaderOf(retried)).toBe('Bearer new-token');
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('does not loop forever — a second 401 after refresh is returned as-is', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === REFRESH_URL) return json(200, { token: 'new-token', refresh_token: 'new-refresh' });
      return json(401, { detail: 'still expired' }); // retry also 401s
    });

    const res = await authFetch(PROTECTED_URL);

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + refresh + one retry, then stop
    expect(onExpired).not.toHaveBeenCalled(); // retry path doesn't tear down
  });

  it('tears down the session via onSessionExpired when refresh itself fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === REFRESH_URL) return json(500, {});
      return json(401, { detail: 'expired' });
    });

    const res = await authFetch(PROTECTED_URL);

    expect(res.status).toBe(401);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tokenStorage.saveTokens).not.toHaveBeenCalled();
  });

  it('tears down the session when there is no refresh token to exchange', async () => {
    (tokenStorage as unknown as { __set: (a: string | null, r: string | null) => void }).__set(
      'old-token',
      null,
    );
    fetchMock.mockImplementation(async (url: string) => {
      if (url === REFRESH_URL) throw new Error('should not be called');
      return json(401, { detail: 'expired' });
    });

    await authFetch(PROTECTED_URL);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent 401s through one /auth/refresh round-trip', async () => {
    fetchMock.mockImplementation(async (url: string, opts?: { headers?: Record<string, string> }) => {
      if (url === REFRESH_URL) return json(200, { token: 'new-token', refresh_token: 'new-refresh' });
      if (opts?.headers?.Authorization === 'Bearer new-token') return json(200, { ok: true });
      return json(401, { detail: 'expired' });
    });

    const [a, b] = await Promise.all([authFetch(PROTECTED_URL), authFetch(PROTECTED_URL)]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === REFRESH_URL);
    expect(refreshCalls).toHaveLength(1); // both 401s shared one refresh
  });
});

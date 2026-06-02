// tokenStorage abstracts SecureStore (native) / localStorage (web) behind one
// async API. Platform.OS defaults to 'ios' under the RN jest preset, so this
// suite exercises the native SecureStore path (mocked in jest.setup.js).
import * as SecureStore from 'expo-secure-store';
import { tokenStorage } from '../tokenStorage';

const TOKEN_KEY = 'wordwise_tokens';

describe('tokenStorage (native / SecureStore path)', () => {
  beforeEach(() => {
    (SecureStore as unknown as { __reset: () => void }).__reset();
    jest.clearAllMocks();
  });

  it('saveTokens writes a single JSON blob under the token key', async () => {
    await tokenStorage.saveTokens('acc', 'ref');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      TOKEN_KEY,
      JSON.stringify({ access: 'acc', refresh: 'ref' }),
    );
  });

  it('getTokens round-trips the saved pair', async () => {
    await tokenStorage.saveTokens('acc', 'ref');
    await expect(tokenStorage.getTokens()).resolves.toEqual({ access: 'acc', refresh: 'ref' });
  });

  it('getTokens returns null when nothing is stored', async () => {
    await expect(tokenStorage.getTokens()).resolves.toBeNull();
  });

  it('getTokens returns null (not throw) on corrupt JSON', async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'not-json');
    await expect(tokenStorage.getTokens()).resolves.toBeNull();
  });

  it('getAccessToken / getRefreshToken pull the respective field', async () => {
    await tokenStorage.saveTokens('acc', 'ref');
    await expect(tokenStorage.getAccessToken()).resolves.toBe('acc');
    await expect(tokenStorage.getRefreshToken()).resolves.toBe('ref');
  });

  it('getAccessToken returns null when there are no tokens', async () => {
    await expect(tokenStorage.getAccessToken()).resolves.toBeNull();
  });

  it('clearTokens deletes the stored pair', async () => {
    await tokenStorage.saveTokens('acc', 'ref');
    await tokenStorage.clearTokens();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    await expect(tokenStorage.getTokens()).resolves.toBeNull();
  });
});

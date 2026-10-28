import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'ariforce.session-token';
const USER_KEY = 'ariforce.user';

/** Session bearer token + last known profile, kept in the device keychain/keystore. */
export const tokenStore = {
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
  setToken: (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token),
  async getUser<T>(): Promise<T | null> {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setUser: (user: unknown) => SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  },
};

/**
 * Login tokens live in expo-secure-store, which is backed by the Android
 * Keystore: encrypted at rest and not readable by other apps (unlike AsyncStorage).
 * An in-memory copy avoids hitting the keystore on every request.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS = 'lc_access_token';
const REFRESH = 'lc_refresh_token';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadTokens(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS);
  refreshToken = await SecureStore.getItemAsync(REFRESH);
  return !!refreshToken;
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  accessToken = access;
  refreshToken = refresh;
  await SecureStore.setItemAsync(ACCESS, access);
  await SecureStore.setItemAsync(REFRESH, refresh);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS);
  await SecureStore.deleteItemAsync(REFRESH);
}

export const getAccessToken = () => accessToken;
export const getRefreshToken = () => refreshToken;

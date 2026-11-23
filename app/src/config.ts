import Constants from 'expo-constants';

/**
 * Backend base URL.
 *
 * 1. EXPO_PUBLIC_API_URL, if set (release builds point this at the hosted server).
 * 2. In development: the laptop running the Expo dev server, port 8000. The
 *    phone already knows that address because it loaded the app from it, so
 *    Wi-Fi IP changes don't need a config edit.
 */
function devServerHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.0.143:8081"
  return hostUri ? hostUri.split(':')[0] : null;
}

const fromEnv = process.env.EXPO_PUBLIC_API_URL;
const devHost = __DEV__ ? devServerHost() : null;

export const API_URL = (fromEnv || (devHost ? `http://${devHost}:8000` : 'http://localhost:8000')).replace(/\/$/, '');

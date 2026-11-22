/** Backend base URL. Set EXPO_PUBLIC_API_URL in app/.env (dev) or the EAS build profile (release). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.29.207:8000').replace(/\/$/, '');

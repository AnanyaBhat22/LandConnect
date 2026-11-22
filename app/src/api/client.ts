/**
 * Small fetch wrapper for the LandConnect API.
 *
 * - Adds `Authorization: Bearer <access token>` automatically.
 * - If a request gets 401 (access token expired after 60 min), it uses the
 *   refresh token ONCE to get new tokens and retries; if that fails too, the
 *   user is signed out (onSessionExpired).
 * - Turns FastAPI error bodies into readable `ApiError` messages for the UI.
 */
import { API_URL } from '../config';
import type { AuthResponse } from './types';
import { clearTokens, getAccessToken, getRefreshToken, saveTokens } from './tokenStore';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

function errorMessage(body: any, status: number): string {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    // Pydantic validation error: "Value error, ..." → field-friendly text
    const field = detail[0].loc?.[detail[0].loc.length - 1];
    return `${field ? `${field}: ` : ''}${String(detail[0].msg).replace(/^Value error, /, '')}`;
  }
  return status >= 500 ? 'Server error, please try again' : `Request failed (${status})`;
}

let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh token for new tokens. Concurrent callers share one request. */
export function refreshTokens(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const refresh = getRefreshToken();
      if (!refresh) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as AuthResponse;
        await saveTokens(data.access_token, data.refresh_token);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type Options = { method?: string; body?: unknown; auth?: boolean };

export async function api<T>(path: string, { method = 'GET', body, auth = true }: Options = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError(0, `Can't reach the server at ${API_URL}. Check your Wi-Fi.`);
  }

  if (res.status === 401 && auth) {
    if (await refreshTokens()) {
      res = await doFetch();
    } else {
      await clearTokens();
      onSessionExpired();
      throw new ApiError(401, 'Your session expired. Please log in again.');
    }
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data as T;
}

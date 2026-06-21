import type { AuthResponse } from '@openrelay/core';

/**
 * Client-side session storage. The JWT is kept in `localStorage` (read by the API
 * client) and mirrored into a readable cookie so the Next.js middleware can guard
 * protected routes without a round-trip. This is a deliberate trade-off for a
 * self-hosted operator console; the API itself only trusts the bearer token.
 */

export const TOKEN_STORAGE_KEY = 'openrelay.token';
export const USER_STORAGE_KEY = 'openrelay.user';
export const AUTH_COOKIE = 'openrelay_auth';

export type SessionUser = AuthResponse['user'];

export function getToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function getStoredUser(): SessionUser | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function persistSession(session: AuthResponse): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TOKEN_STORAGE_KEY, session.token);
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
  // 7 day cookie, matching the API's default JWT expiry. Not httpOnly by design.
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=${String(maxAge)}; samesite=lax`;
}

export function clearSession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

import type { Database, TwitchConnectionRow } from '@openrelay/db';
import { twitchConnections } from '@openrelay/db';
import { eq } from 'drizzle-orm';
import type { TokenCipher } from './crypto.js';
import { AppError } from './errors.js';
import type { TwitchClient } from './twitch-client.js';

/**
 * Persistence + refresh logic for a user's Twitch OAuth tokens. Access/refresh
 * tokens are always stored encrypted (see {@link ./crypto.js}); this module is
 * the single place that decrypts them, transparently refreshing and re-persisting
 * when the access token is expired (or about to be).
 */

/** Refresh proactively when the token has under this many seconds left. */
const EXPIRY_SKEW_SECONDS = 60;

/** Load a user's connection row, or throw a clear not-connected error. */
export async function loadConnection(db: Database, userId: string): Promise<TwitchConnectionRow> {
  const row = await db.query.twitchConnections.findFirst({
    where: eq(twitchConnections.userId, userId),
  });
  if (!row) {
    throw AppError.notFound('no Twitch account is connected');
  }
  return row;
}

/**
 * Return a valid Twitch access token for the user, refreshing and persisting a
 * new token pair when the stored one has expired. Throws if the user has no
 * connection.
 */
export async function getValidAccessToken(
  db: Database,
  client: TwitchClient,
  cipher: TokenCipher,
  userId: string,
): Promise<string> {
  const row = await loadConnection(db, userId);
  const expiresAtMs = new Date(row.expiresAt).getTime();
  const stillValid = expiresAtMs - EXPIRY_SKEW_SECONDS * 1000 > Date.now();
  if (stillValid) {
    return cipher.decrypt(row.accessTokenEnc);
  }

  const refreshToken = cipher.decrypt(row.refreshTokenEnc);
  const tokens = await client.refresh(refreshToken);
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();
  await db
    .update(twitchConnections)
    .set({
      accessTokenEnc: cipher.encrypt(tokens.accessToken),
      refreshTokenEnc: cipher.encrypt(tokens.refreshToken),
      scope: tokens.scope,
      expiresAt,
    })
    .where(eq(twitchConnections.userId, userId));
  return tokens.accessToken;
}

import {
  Clip,
  ImportTwitchClipsRequest,
  ListTwitchClipsRequest,
  TwitchAuthUrlResponse,
  TwitchClipSummary,
  TwitchConnection,
  type Clip as ClipType,
} from '@openrelay/core';
import { clips, twitchConnections } from '@openrelay/db';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl } from '../access.js';
import { AppError } from '../errors.js';
import { newClipId, newTwitchConnectionId } from '../ids.js';
import { toClip, toTwitchConnection } from '../mappers.js';
import { buildClipObjectKey } from '../s3.js';
import { safeEqual } from '../crypto.js';
import { getValidAccessToken, loadConnection } from '../twitch-tokens.js';
import { StreamIdParams } from './schemas.js';

/** OAuth `state` lifetime; the callback rejects anything older. */
const STATE_TTL_MS = 10 * 60 * 1000;

const CallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

/**
 * Per-user Twitch OAuth connect + clip import. The connect flow signs a
 * short-lived JWT `state` carrying the caller's user id so the public callback
 * (which has no session) can attribute the connection. Imported clips download
 * the MP4 server-side and store it in the same media library as uploads, so they
 * play as BRB/clip scenes with no engine change.
 */
export function registerTwitchRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  /** Assert the feature is configured (client id/secret + a built client). */
  const requireTwitch = (): NonNullable<typeof app.twitch> => {
    if (!app.config.twitch.isConfigured || app.twitch === null) {
      throw new AppError('validation_error', 'Twitch integration is not configured');
    }
    return app.twitch;
  };

  // Begin the OAuth flow: return the authorize URL with a signed state token.
  r.get(
    '/twitch/connect',
    { ...auth, schema: { response: { 200: TwitchAuthUrlResponse } } },
    (request) => {
      const client = requireTwitch();
      const state = signState(app.config.twitch.tokenEncryptionKey, request.user.id);
      return { authorizeUrl: client.buildAuthorizeUrl(state) };
    },
  );

  // OAuth callback (public — authenticated by the signed `state`, not a session).
  app.get('/twitch/callback', async (request, reply) => {
    const client = requireTwitch();
    const query = CallbackQuery.parse(request.query);
    const webUrl = app.config.twitch.webRedirect;
    if (query.error !== undefined || query.code === undefined || query.state === undefined) {
      return reply.redirect(`${webUrl}/?twitch=error`);
    }

    const userId = verifyState(app.config.twitch.tokenEncryptionKey, query.state);
    const tokens = await client.exchangeCode(query.code);
    const account = await client.getUser(tokens.accessToken);
    const cipher = app.twitchCipher;
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

    const existing = await app.db.query.twitchConnections.findFirst({
      where: eq(twitchConnections.userId, userId),
    });
    if (existing) {
      await app.db
        .update(twitchConnections)
        .set({
          twitchUserId: account.id,
          twitchLogin: account.login,
          accessTokenEnc: cipher.encrypt(tokens.accessToken),
          refreshTokenEnc: cipher.encrypt(tokens.refreshToken),
          scope: tokens.scope,
          expiresAt,
        })
        .where(eq(twitchConnections.userId, userId));
    } else {
      await app.db.insert(twitchConnections).values({
        id: newTwitchConnectionId(),
        userId,
        twitchUserId: account.id,
        twitchLogin: account.login,
        accessTokenEnc: cipher.encrypt(tokens.accessToken),
        refreshTokenEnc: cipher.encrypt(tokens.refreshToken),
        scope: tokens.scope,
        expiresAt,
      });
    }

    return reply.redirect(`${webUrl}/?twitch=connected`);
  });

  // The current user's linked Twitch account (no tokens), or 404.
  r.get(
    '/twitch/connection',
    { ...auth, schema: { response: { 200: TwitchConnection } } },
    async (request) => {
      const row = await loadConnection(app.db, request.user.id);
      return toTwitchConnection(row);
    },
  );

  // Disconnect: delete the linked account.
  r.delete(
    '/twitch/connection',
    { ...auth, schema: { response: { 204: z.null() } } },
    async (request, reply) => {
      await app.db.delete(twitchConnections).where(eq(twitchConnections.userId, request.user.id));
      return reply.code(204).send(null);
    },
  );

  // List a channel's clips for the import picker.
  r.post(
    '/streams/:id/twitch/clips/list',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: ListTwitchClipsRequest,
        response: { 200: z.array(TwitchClipSummary) },
      },
    },
    async (request) => {
      const client = requireTwitch();
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const accessToken = await getValidAccessToken(
        app.db,
        client,
        app.twitchCipher,
        request.user.id,
      );
      const broadcasterId = await client.getUserByLogin(request.body.channel, accessToken);
      return client.listClips(
        { broadcasterId, period: request.body.period, limit: request.body.limit },
        accessToken,
      );
    },
  );

  // Import selected clips: download each MP4, store it, and create clip rows.
  r.post(
    '/streams/:id/twitch/clips/import',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: ImportTwitchClipsRequest,
        response: { 201: z.array(Clip) },
      },
    },
    async (request, reply) => {
      const client = requireTwitch();
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const accessToken = await getValidAccessToken(
        app.db,
        client,
        app.twitchCipher,
        request.user.id,
      );

      // Fetch metadata for the requested clips so we can label them.
      const broadcasterClips = await fetchClipMetadata(client, accessToken, request.body.clipIds);

      const created: ClipType[] = [];
      for (const clipId of request.body.clipIds) {
        const meta = broadcasterClips.get(clipId);
        const download = await app.clipDownloader.downloadClip(clipId);
        const id = newClipId();
        const label = truncateLabel(meta?.title ?? `Twitch clip ${clipId}`);
        const filename = `${clipId}.mp4`;
        const objectKey = buildClipObjectKey(access.stream.id, id, filename);
        await app.s3.putObject({
          key: objectKey,
          contentType: download.contentType,
          body: download.body,
        });
        const [row] = await app.db
          .insert(clips)
          .values({
            id,
            streamId: access.stream.id,
            label,
            objectKey,
            contentType: download.contentType,
            sizeBytes: download.body.byteLength,
            durationSeconds: meta ? Math.round(meta.durationSeconds) : null,
            source: 'twitch',
            sourceRef: clipId,
          })
          .returning();
        if (!row) {
          throw new AppError('internal_error', 'failed to register imported clip');
        }
        created.push(toClip(row, app.config.apiPublicUrl));
      }

      return reply.code(201).send(created);
    },
  );
}

/** Look up clip metadata by id; tolerant of unknown ids (returns a partial map). */
async function fetchClipMetadata(
  client: NonNullable<FastifyInstance['twitch']>,
  accessToken: string,
  clipIds: readonly string[],
): Promise<Map<string, TwitchClipSummary>> {
  const summaries = await client.getClipsByIds(clipIds, accessToken);
  return new Map(summaries.map((c) => [c.id, c]));
}

/**
 * Sign an opaque, tamper-proof OAuth `state` binding the caller's user id and a
 * timestamp with an HMAC. The public callback verifies this to attribute the
 * connection without needing a session. Format: `userId.issuedAtMs.signature`.
 */
function signState(secret: string, userId: string): string {
  const issuedAt = Date.now().toString();
  const payload = `${userId}.${issuedAt}`;
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/** Verify a signed OAuth `state` and extract the originating user id. */
function verifyState(secret: string, state: string): string {
  const parts = state.split('.');
  if (parts.length !== 3) {
    throw AppError.unauthorized('invalid OAuth state');
  }
  const [userId, issuedAt, signature] = parts as [string, string, string];
  const payload = `${userId}.${issuedAt}`;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) {
    throw AppError.unauthorized('invalid OAuth state');
  }
  const issuedAtMs = Number(issuedAt);
  if (!Number.isFinite(issuedAtMs) || Date.now() - issuedAtMs > STATE_TTL_MS) {
    throw AppError.unauthorized('expired OAuth state');
  }
  return userId;
}

/** Clamp a clip title to the 80-char limit the Clip schema enforces. */
function truncateLabel(title: string): string {
  const trimmed = title.trim();
  const safe = trimmed.length > 0 ? trimmed : 'Twitch clip';
  return safe.length > 80 ? safe.slice(0, 80) : safe;
}

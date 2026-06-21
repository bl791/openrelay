import {
  clips,
  destinations,
  friendConnections,
  ingests,
  scenes,
  streams,
  twitchConnections,
  users,
} from '@openrelay/db';
import { Readable } from 'node:stream';
import type * as DrizzleOrm from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';
import type { EngineClient } from './engine-client.js';
import { createLogger } from './logger.js';
import { buildApp } from './server.js';
import type { MediaStorage } from './s3.js';
import { createFakeDatabase, registerFakeTables } from './testing.js';
import type { TwitchClient } from './twitch-client.js';
import type { ClipDownloader } from './twitch-download.js';

// Replace drizzle's SQL-building operators with plain-predicate stubs the fake
// in-memory database understands, while preserving the rest of the real module
// (the schema definitions depend on `pgTable`, `relations`, etc.).
vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof DrizzleOrm>();
  const stubs = await import('./testing.js');
  return {
    ...actual,
    eq: stubs.eqStub,
    and: stubs.andStub,
    inArray: stubs.inArrayStub,
    asc: stubs.ascStub,
    desc: stubs.descStub,
  };
});

registerFakeTables({
  users,
  streams,
  ingests,
  destinations,
  scenes,
  friendConnections,
  clips,
  twitchConnections,
});

const config: Config = {
  port: 0,
  host: '127.0.0.1',
  databaseUrl: 'postgres://unused',
  jwtSecret: 'test-secret-test-secret-test-secret-123',
  jwtExpiresIn: '1h',
  engineUrl: 'http://engine.local',
  engineToken: 'engine-token',
  apiPublicUrl: 'http://api.example.com',
  publicIngestHost: 'ingest.example.com',
  rtmpPort: 1935,
  srtPort: 9000,
  logLevel: 'silent',
  s3: {
    endpoint: 'http://localhost:9000',
    publicUrl: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'openrelay-media',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    mediaBaseUrl: 'http://localhost:9000/openrelay-media',
  },
  twitch: {
    isConfigured: true,
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://api.example.com/api/twitch/callback',
    tokenEncryptionKey: 'test-secret-test-secret-test-secret-123',
    webRedirect: 'http://localhost:3000',
  },
};

/** In-memory media storage stub: records calls and keeps objects in a map, no network. */
function fakeStorage(): MediaStorage {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    mediaBaseUrl: config.s3.mediaBaseUrl,
    presignUpload: vi
      .fn()
      .mockImplementation((input: { key: string }) =>
        Promise.resolve(`http://localhost:9000/openrelay-media/${input.key}?signature=test`),
      ),
    putObject: vi
      .fn()
      .mockImplementation((input: { key: string; contentType: string; body: Buffer }) => {
        objects.set(input.key, { body: input.body, contentType: input.contentType });
        return Promise.resolve();
      }),
    getObject: vi.fn().mockImplementation((key: string) => {
      const stored = objects.get(key);
      if (!stored) {
        return Promise.reject(new Error('not found'));
      }
      return Promise.resolve({
        body: Readable.from(stored.body),
        contentType: stored.contentType,
        contentLength: stored.body.byteLength,
      });
    }),
    deleteObject: vi.fn().mockImplementation((key: string) => {
      objects.delete(key);
      return Promise.resolve();
    }),
  };
}

/** Structural stand-in for the engine HTTP client; no real engine is contacted. */
function fakeEngine(): EngineClient {
  const runtime = {
    streamId: 'stream_runtime_id',
    status: 'starting' as const,
    activeSceneId: null,
    uptimeSeconds: 0,
    onFailover: false,
    ingests: [],
    destinations: [],
  };
  return {
    startStream: vi.fn().mockResolvedValue(runtime),
    stopStream: vi.fn().mockResolvedValue(undefined),
    switchScene: vi.fn().mockResolvedValue(runtime),
    setActiveIngest: vi.fn().mockResolvedValue(runtime),
    getRuntime: vi.fn().mockResolvedValue(runtime),
    openEventStream: vi.fn(),
  } as unknown as EngineClient;
}

/** Structural Twitch client stub: no network, deterministic responses. */
function fakeTwitchClient(): TwitchClient {
  return {
    buildAuthorizeUrl: vi
      .fn()
      .mockImplementation(
        (state: string) =>
          `https://id.twitch.tv/oauth2/authorize?client_id=test-client-id&state=${state}`,
      ),
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      scope: 'user:read:email',
    }),
    refresh: vi.fn().mockResolvedValue({
      accessToken: 'access-token-2',
      refreshToken: 'refresh-token-2',
      expiresIn: 3600,
      scope: 'user:read:email',
    }),
    getUser: vi.fn().mockResolvedValue({ id: 'tw_12345', login: 'streamer' }),
    getUserByLogin: vi.fn().mockResolvedValue('tw_broadcaster'),
    listClips: vi.fn().mockResolvedValue([
      {
        id: 'ClipOne',
        title: 'Sick play',
        thumbnailUrl: 'https://clips.twitch.tv/thumb/ClipOne.jpg',
        durationSeconds: 12.5,
        creatorName: 'fan',
        viewCount: 100,
        createdAt: '2026-06-01T00:00:00Z',
      },
    ]),
    getClipsByIds: vi.fn().mockImplementation((ids: readonly string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          title: `Title ${id}`,
          thumbnailUrl: `https://clips.twitch.tv/thumb/${id}.jpg`,
          durationSeconds: 8,
          creatorName: 'fan',
          viewCount: 5,
          createdAt: '2026-06-01T00:00:00Z',
        })),
      ),
    ),
  } as unknown as TwitchClient;
}

/** Clip downloader stub returning deterministic MP4 bytes, no shelling out. */
function fakeClipDownloader(): ClipDownloader {
  return {
    downloadClip: vi.fn().mockImplementation((clipId: string) =>
      Promise.resolve({
        body: Buffer.from(`mp4-bytes-${clipId}`),
        contentType: 'video/mp4',
      }),
    ),
  };
}

interface MakeAppOverrides {
  twitchClient?: TwitchClient | null;
  clipDownloader?: ClipDownloader;
}

async function makeApp(overrides: MakeAppOverrides = {}): Promise<FastifyInstance> {
  const { db } = createFakeDatabase();
  // `null` explicitly disables injection (a real/absent client); otherwise use
  // the supplied stub or a default fake. Built conditionally so we never pass
  // `undefined` under exactOptionalPropertyTypes.
  const twitchClient =
    overrides.twitchClient === null ? null : (overrides.twitchClient ?? fakeTwitchClient());
  const app = await buildApp({
    config,
    logger: createLogger('silent'),
    database: db,
    engine: fakeEngine(),
    storage: fakeStorage(),
    ...(twitchClient !== null ? { twitchClient } : {}),
    clipDownloader: overrides.clipDownloader ?? fakeClipDownloader(),
  });
  await app.ready();
  return app;
}

async function register(
  app: FastifyInstance,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'correct horse battery', displayName: 'Test User' },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

describe('OpenRelay API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await makeApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds on /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('registers, logs in, and returns the current user', async () => {
    const { token } = await register(app, 'alice@example.com');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ email: string }>().email).toBe('alice@example.com');
  });

  it('rejects duplicate registration with 409', async () => {
    await register(app, 'dup@example.com');
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'dup@example.com', password: 'correct horse battery', displayName: 'X' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { code: string } }>().error.code).toBe('conflict');
  });

  it('rejects bad login credentials with 401', async () => {
    await register(app, 'bob@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'bob@example.com', password: 'wrong wrong wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('enforces auth on protected routes (401 without token)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/streams' });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('unauthorized');
  });

  it('creates a stream with default Main + BRB scenes and active scene set', async () => {
    const { token } = await register(app, 'carol@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'My First Stream' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      id: string;
      activeSceneId: string | null;
      scenes: { label: string; kind: string }[];
    }>();
    expect(body.scenes).toHaveLength(2);
    expect(body.scenes.map((s) => s.label)).toEqual(['Main', 'BRB']);
    expect(body.scenes[0]?.kind).toBe('ingest');
    expect(body.scenes[1]?.kind).toBe('color');
    expect(body.activeSceneId).not.toBeNull();
  });

  it('runs the full create-ingest-destination-hydrate flow with redaction', async () => {
    const { token } = await register(app, 'dave@example.com');
    const auth = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: auth,
      payload: { title: 'Flow Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const ingest = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/ingests`,
      headers: auth,
      payload: { label: 'Main Ingest', protocol: 'rtmp' },
    });
    expect(ingest.statusCode).toBe(201);
    const ingestBody = ingest.json<{ pushUrl: string; streamKey: string }>();
    expect(ingestBody.pushUrl).toContain('rtmp://ingest.example.com:1935/live/');
    expect(ingestBody.streamKey.length).toBeGreaterThanOrEqual(8);

    const dest = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/destinations`,
      headers: auth,
      payload: {
        label: 'Twitch',
        platform: 'twitch',
        url: 'rtmp://live.twitch.tv/app',
        streamKey: 'live_secret_key',
        enabled: true,
      },
    });
    expect(dest.statusCode).toBe(201);
    // Creation echoes the key back once.
    expect(dest.json<{ streamKey: string }>().streamKey).toBe('live_secret_key');

    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: auth,
    });
    expect(hydrated.statusCode).toBe(200);
    const full = hydrated.json<{
      ingests: unknown[];
      destinations: { streamKey: string }[];
      scenes: unknown[];
    }>();
    expect(full.ingests).toHaveLength(1);
    expect(full.scenes).toHaveLength(2);
    expect(full.destinations).toHaveLength(1);
    // List/detail responses redact destination stream keys.
    expect(full.destinations[0]?.streamKey).toBe('__redacted__');
    expect(full.destinations[0]?.streamKey).not.toBe('live_secret_key');
  });

  it('enforces ownership: a different user gets 404 for another user stream', async () => {
    const owner = await register(app, 'owner@example.com');
    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { title: 'Private Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const intruder = await register(app, 'intruder@example.com');
    const res = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: { authorization: `Bearer ${intruder.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('grants a friend read access and enforces viewer read-only', async () => {
    const owner = await register(app, 'streamer@example.com');
    const friend = await register(app, 'friend@example.com');
    const ownerAuth = { authorization: `Bearer ${owner.token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: ownerAuth,
      payload: { title: 'Shared Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const grant = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/friends`,
      headers: ownerAuth,
      payload: { email: 'friend@example.com', role: 'viewer' },
    });
    expect(grant.statusCode).toBe(201);

    const friendAuth = { authorization: `Bearer ${friend.token}` };

    // Viewer can read.
    const read = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: friendAuth,
    });
    expect(read.statusCode).toBe(200);

    // Shared stream shows up in the friend's list.
    const list = await app.inject({ method: 'GET', url: '/api/streams', headers: friendAuth });
    expect(list.json<unknown[]>()).toHaveLength(1);

    // Viewer cannot mutate.
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/streams/${streamId}`,
      headers: friendAuth,
      payload: { title: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(403);

    // Viewer cannot delete (owner-only).
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/streams/${streamId}`,
      headers: friendAuth,
    });
    expect(del.statusCode).toBe(403);
  });

  it('starts a stream via the engine client', async () => {
    const { token } = await register(app, 'live@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: auth,
      payload: { title: 'Going Live' },
    });
    const streamId = created.json<{ id: string }>().id;

    const start = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/start`,
      headers: auth,
    });
    expect(start.statusCode).toBe(200);
    expect(start.json<{ status: string }>().status).toBe('starting');
  });

  it('presigns, registers and lists clips in the media library', async () => {
    const { token } = await register(app, 'media@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: auth,
      payload: { title: 'Clips Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const presign = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/clips/presign`,
      headers: auth,
      payload: { filename: 'My BRB Clip.mp4', contentType: 'video/mp4' },
    });
    expect(presign.statusCode).toBe(200);
    const presigned = presign.json<{ uploadUrl: string; objectKey: string; method: string }>();
    expect(presigned.method).toBe('PUT');
    expect(presigned.objectKey).toContain(`clips/${streamId}/`);
    expect(presigned.objectKey).toContain('my-brb-clip.mp4');
    expect(presigned.uploadUrl).toContain(presigned.objectKey);

    const register_ = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/clips`,
      headers: auth,
      payload: {
        label: 'My BRB Clip',
        objectKey: presigned.objectKey,
        contentType: 'video/mp4',
        sizeBytes: 2048,
        durationSeconds: 10,
      },
    });
    expect(register_.statusCode).toBe(201);
    const clip = register_.json<{ id: string; url: string; label: string }>();
    expect(clip.label).toBe('My BRB Clip');
    // The browser-facing URL proxies content through the API, never the store.
    expect(clip.url).toBe(`http://api.example.com/api/clips/${clip.id}/content`);

    const list = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}/clips`,
      headers: auth,
    });
    expect(list.statusCode).toBe(200);
    const clipList = list.json<{ id: string }[]>();
    expect(clipList).toHaveLength(1);
    expect(clipList[0]?.id).toBe(clip.id);

    // The clip also appears on the hydrated stream detail response.
    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: auth,
    });
    expect(hydrated.json<{ clips: unknown[] }>().clips).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/clips/${clip.id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
  });

  it('uploads a clip through the API proxy and serves its content back', async () => {
    const { token } = await register(app, 'upload@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const streamId = (
      await app.inject({
        method: 'POST',
        url: '/api/streams',
        headers: auth,
        payload: { title: 'Upload Stream' },
      })
    ).json<{ id: string }>().id;

    // Build a multipart body with a label field + a small PNG-ish file.
    const boundary = '----openrelaytest';
    const fileBytes = Buffer.from('fake-png-bytes');
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="label"\r\n\r\nMy Upload\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="brb.png"\r\n` +
          `Content-Type: image/png\r\n\r\n`,
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const upload = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/clips/upload`,
      headers: { ...auth, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const clip = upload.json<{ id: string; url: string; label: string; sizeBytes: number }>();
    expect(clip.label).toBe('My Upload');
    expect(clip.sizeBytes).toBe(fileBytes.byteLength);
    expect(clip.url).toBe(`http://api.example.com/api/clips/${clip.id}/content`);

    // The content proxy serves the stored bytes back (no auth required).
    const content = await app.inject({ method: 'GET', url: `/api/clips/${clip.id}/content` });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('image/png');
    expect(content.rawPayload.equals(fileBytes)).toBe(true);
  });

  it('provisions a shared guest ingest for a collaborator and lets the guest delete it', async () => {
    const owner = await register(app, 'host@example.com');
    const guest = await register(app, 'guest@example.com');
    const ownerAuth = { authorization: `Bearer ${owner.token}` };
    const guestAuth = { authorization: `Bearer ${guest.token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: ownerAuth,
      payload: { title: 'Collab Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    // Provisioning for a non-collaborator email fails with a clear error.
    const notFriend = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/shared-ingests`,
      headers: ownerAuth,
      payload: { label: 'Guest feed', protocol: 'rtmp', ownerEmail: 'guest@example.com' },
    });
    expect(notFriend.statusCode).toBe(400);
    expect(notFriend.json<{ error: { code: string } }>().error.code).toBe('validation_error');

    // Grant the guest collaborator access first.
    const grant = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/friends`,
      headers: ownerAuth,
      payload: { email: 'guest@example.com', role: 'operator' },
    });
    expect(grant.statusCode).toBe(201);

    // Now provisioning the shared ingest succeeds, returning connection info.
    const provisioned = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/shared-ingests`,
      headers: ownerAuth,
      payload: { label: 'Guest feed', protocol: 'rtmp', ownerEmail: 'guest@example.com' },
    });
    expect(provisioned.statusCode).toBe(201);
    const shared = provisioned.json<{
      id: string;
      ownerUserId: string | null;
      connection: { server: string; streamKey: string; url: string };
    }>();
    expect(shared.ownerUserId).toBe(guest.userId);
    expect(shared.connection.url).toContain('rtmp://ingest.example.com:1935/live/');
    expect(shared.connection.server).toBe('rtmp://ingest.example.com:1935/live');
    expect(shared.connection.streamKey.length).toBeGreaterThanOrEqual(8);

    // The guest ingest appears on the hydrated detail with ownerUserId set.
    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: ownerAuth,
    });
    const ingestsList = hydrated.json<{ ingests: { id: string; ownerUserId: string | null }[] }>()
      .ingests;
    const guestIngest = ingestsList.find((i) => i.ownerUserId === guest.userId);
    expect(guestIngest?.id).toBe(shared.id);

    // The guest can delete their own ingest.
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/ingests/${shared.id}`,
      headers: guestAuth,
    });
    expect(del.statusCode).toBe(204);
  });

  it('auto-provisions a guest ingest when adding a friend with provisionIngest', async () => {
    const owner = await register(app, 'autohost@example.com');
    await register(app, 'autoguest@example.com');
    const ownerAuth = { authorization: `Bearer ${owner.token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: ownerAuth,
      payload: { title: 'Auto Provision Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const grant = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/friends`,
      headers: ownerAuth,
      payload: { email: 'autoguest@example.com', role: 'operator', provisionIngest: true },
    });
    expect(grant.statusCode).toBe(201);

    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: ownerAuth,
    });
    const ingestsList = hydrated.json<{ ingests: { ownerUserId: string | null }[] }>().ingests;
    expect(ingestsList.some((i) => i.ownerUserId !== null)).toBe(true);
  });

  it('forbids a viewer from switching the active ingest', async () => {
    const owner = await register(app, 'vhost@example.com');
    const viewer = await register(app, 'vviewer@example.com');
    const ownerAuth = { authorization: `Bearer ${owner.token}` };
    const viewerAuth = { authorization: `Bearer ${viewer.token}` };

    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: ownerAuth,
      payload: { title: 'Viewer Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const ingest = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/ingests`,
      headers: ownerAuth,
      payload: { label: 'Main', protocol: 'rtmp' },
    });
    const ingestId = ingest.json<{ id: string }>().id;

    const grant = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/friends`,
      headers: ownerAuth,
      payload: { email: 'vviewer@example.com', role: 'viewer' },
    });
    expect(grant.statusCode).toBe(201);

    const switchAttempt = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/ingest`,
      headers: viewerAuth,
      payload: { ingestId },
    });
    expect(switchAttempt.statusCode).toBe(403);
  });

  it('rejects the engine status callback without the engine token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/engine/status',
      payload: {
        event: { type: 'failover', streamId: 'stream_unknownnnn', active: true },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('applies a runtime status callback to the persisted stream state', async () => {
    const { token } = await register(app, 'reconcile@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: auth,
      payload: { title: 'Reconcile Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const callback = await app.inject({
      method: 'POST',
      url: '/internal/engine/status',
      headers: { authorization: `Bearer ${config.engineToken}` },
      payload: {
        event: {
          type: 'runtime',
          runtime: {
            streamId,
            status: 'live',
            activeSceneId: null,
            uptimeSeconds: 5,
            onFailover: false,
            ingests: [],
            destinations: [],
          },
        },
      },
    });
    expect(callback.statusCode).toBe(204);

    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: auth,
    });
    expect(hydrated.json<{ status: string }>().status).toBe('live');
  });

  it('rejects quickstart without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/quickstart',
      payload: { title: 'No Auth', protocol: 'rtmp' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('quickstart provisions a ready-to-stream setup and exposes connection info', async () => {
    const { token } = await register(app, 'quick@example.com');
    const auth = { authorization: `Bearer ${token}` };

    const res = await app.inject({
      method: 'POST',
      url: '/api/quickstart',
      headers: auth,
      payload: { title: 'Go Live Now', protocol: 'rtmp' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      streamId: string;
      title: string;
      ingest: { server: string; streamKey: string; url: string; protocol: string };
      connectToken: string;
    }>();
    expect(body.streamId.length).toBeGreaterThan(0);
    expect(body.title).toBe('Go Live Now');
    expect(body.ingest.protocol).toBe('rtmp');
    expect(body.ingest.server).toBe('rtmp://ingest.example.com:1935/live');
    expect(body.ingest.streamKey.length).toBeGreaterThanOrEqual(8);
    expect(body.ingest.url).toContain('rtmp://ingest.example.com:1935/live/');
    expect(body.connectToken.length).toBeGreaterThan(0);

    // The created stream is fetchable and carries an ingest + seeded scenes.
    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${body.streamId}`,
      headers: auth,
    });
    expect(hydrated.statusCode).toBe(200);
    const full = hydrated.json<{
      ingests: unknown[];
      scenes: { label: string }[];
    }>();
    expect(full.ingests).toHaveLength(1);
    expect(full.scenes.map((s) => s.label)).toEqual(['Main', 'BRB']);

    // The per-stream connection endpoint returns the same primary ingest info.
    const connection = await app.inject({
      method: 'GET',
      url: `/api/streams/${body.streamId}/connection`,
      headers: auth,
    });
    expect(connection.statusCode).toBe(200);
    const conn = connection.json<{ server: string; streamKey: string; url: string }>();
    expect(conn.server).toBe('rtmp://ingest.example.com:1935/live');
    expect(conn.streamKey).toBe(body.ingest.streamKey);
    expect(conn.url).toBe(body.ingest.url);
  });

  it('returns 404 for connection info when a stream has no ingest', async () => {
    const { token } = await register(app, 'noingest@example.com');
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: 'POST',
      url: '/api/streams',
      headers: auth,
      payload: { title: 'No Ingest Stream' },
    });
    const streamId = created.json<{ id: string }>().id;

    const connection = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}/connection`,
      headers: auth,
    });
    expect(connection.statusCode).toBe(404);
  });

  it('returns 404 for the Twitch connection before connecting', async () => {
    const { token } = await register(app, 'tw-none@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/twitch/connection',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('completes the Twitch OAuth connect + callback flow and exposes the account', async () => {
    const { token } = await register(app, 'tw-connect@example.com');
    const authHeader = { authorization: `Bearer ${token}` };

    // Connect returns an authorize URL carrying a signed state token.
    const connect = await app.inject({
      method: 'GET',
      url: '/api/twitch/connect',
      headers: authHeader,
    });
    expect(connect.statusCode).toBe(200);
    const { authorizeUrl } = connect.json<{ authorizeUrl: string }>();
    const state = new URL(authorizeUrl).searchParams.get('state');
    expect(state).not.toBeNull();

    // The public callback links the account and redirects back to the web app.
    const callback = await app.inject({
      method: 'GET',
      url: `/api/twitch/callback?code=auth-code&state=${encodeURIComponent(state ?? '')}`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:3000/?twitch=connected');

    // The connection is now visible (no tokens in the payload).
    const conn = await app.inject({
      method: 'GET',
      url: '/api/twitch/connection',
      headers: authHeader,
    });
    expect(conn.statusCode).toBe(200);
    const body = conn.json<Record<string, unknown>>();
    expect(body.twitchLogin).toBe('streamer');
    expect(body.twitchUserId).toBe('tw_12345');
    expect(JSON.stringify(body)).not.toContain('access-token');
    expect(JSON.stringify(body)).not.toContain('refresh-token');

    // Disconnect removes it.
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/twitch/connection',
      headers: authHeader,
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET',
      url: '/api/twitch/connection',
      headers: authHeader,
    });
    expect(after.statusCode).toBe(404);
  });

  it('rejects Twitch clip import without auth (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/streams/stream_anything/twitch/clips/import',
      payload: { clipIds: ['ClipOne'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists and imports Twitch clips, creating source=twitch clip rows', async () => {
    const { token } = await register(app, 'tw-import@example.com');
    const authHeader = { authorization: `Bearer ${token}` };

    // Connect the account first (import needs a token).
    const connect = await app.inject({
      method: 'GET',
      url: '/api/twitch/connect',
      headers: authHeader,
    });
    const state = new URL(connect.json<{ authorizeUrl: string }>().authorizeUrl).searchParams.get(
      'state',
    );
    await app.inject({
      method: 'GET',
      url: `/api/twitch/callback?code=auth-code&state=${encodeURIComponent(state ?? '')}`,
    });

    const streamId = (
      await app.inject({
        method: 'POST',
        url: '/api/streams',
        headers: authHeader,
        payload: { title: 'Twitch Import Stream' },
      })
    ).json<{ id: string }>().id;

    // List a channel's clips.
    const list = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/twitch/clips/list`,
      headers: authHeader,
      payload: { channel: 'streamer', period: 'week', limit: 10 },
    });
    expect(list.statusCode).toBe(200);
    const clipSummaries = list.json<{ id: string }[]>();
    expect(clipSummaries[0]?.id).toBe('ClipOne');

    // Import two clips.
    const importRes = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/twitch/clips/import`,
      headers: authHeader,
      payload: { clipIds: ['ClipOne', 'ClipTwo'] },
    });
    expect(importRes.statusCode).toBe(201);
    const imported =
      importRes.json<{ id: string; source: string; sourceRef: string; label: string }[]>();
    expect(imported).toHaveLength(2);
    expect(imported.every((c) => c.source === 'twitch')).toBe(true);
    expect(imported.map((c) => c.sourceRef)).toEqual(['ClipOne', 'ClipTwo']);
    expect(imported[0]?.label).toBe('Title ClipOne');

    // They appear on the hydrated stream detail as clips.
    const hydrated = await app.inject({
      method: 'GET',
      url: `/api/streams/${streamId}`,
      headers: authHeader,
    });
    const hydratedClips = hydrated.json<{ clips: { source: string }[] }>().clips;
    expect(hydratedClips).toHaveLength(2);
    expect(hydratedClips.every((c) => c.source === 'twitch')).toBe(true);
  });

  it('forbids a non-owner from importing Twitch clips (404 stream access)', async () => {
    const owner = await register(app, 'tw-owner@example.com');
    const streamId = (
      await app.inject({
        method: 'POST',
        url: '/api/streams',
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { title: 'Owner Only' },
      })
    ).json<{ id: string }>().id;

    const intruder = await register(app, 'tw-intruder@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/api/streams/${streamId}/twitch/clips/import`,
      headers: { authorization: `Bearer ${intruder.token}` },
      payload: { clipIds: ['ClipOne'] },
    });
    expect(res.statusCode).toBe(404);
  });
});

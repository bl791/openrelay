import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from './config.js';
import { createLogger } from './logger.js';
import { buildEngine, type Engine } from './server.js';
import { streamSpec } from './fixtures.js';

const config: Config = {
  port: 0,
  host: '127.0.0.1',
  token: 'test-token',
  ingestHost: '127.0.0.1',
  rtmpPort: 1935,
  srtPort: 8890,
  simulate: true,
  mediaDir: '/tmp/media',
  apiCallbackUrl: null,
  logLevel: 'silent',
};

const authHeaders = { authorization: `Bearer ${config.token}` };

describe('engine HTTP control plane', () => {
  let engine: Engine;

  beforeEach(async () => {
    engine = await buildEngine(config, createLogger('silent'));
    await engine.app.ready();
  });

  afterEach(async () => {
    await engine.app.close();
  });

  it('healthz is public', async () => {
    const res = await engine.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ok');
  });

  it('rejects unauthenticated control requests', async () => {
    const res = await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      payload: { spec: streamSpec() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: { authorization: 'Bearer wrong' },
      payload: { spec: streamSpec() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('starts, queries runtime, and stops a stream', async () => {
    const start = await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: authHeaders,
      payload: { spec: streamSpec() },
    });
    expect(start.statusCode).toBe(201);
    expect(start.json<{ status: string }>().status).toBe('live');

    const runtime = await engine.app.inject({
      method: 'GET',
      url: '/streams/stream-1/runtime',
      headers: authHeaders,
    });
    expect(runtime.statusCode).toBe(200);
    expect(runtime.json<{ streamId: string }>().streamId).toBe('stream-1');

    const stop = await engine.app.inject({
      method: 'POST',
      url: '/streams/stop',
      headers: authHeaders,
      payload: { streamId: 'stream-1' },
    });
    expect(stop.statusCode).toBe(200);
  });

  it('409s on starting a duplicate stream', async () => {
    const payload = { spec: streamSpec() };
    await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: authHeaders,
      payload,
    });
    const dup = await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: authHeaders,
      payload,
    });
    expect(dup.statusCode).toBe(409);
  });

  it('404s runtime for an unknown stream', async () => {
    const res = await engine.app.inject({
      method: 'GET',
      url: '/streams/ghost/runtime',
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('400s on a malformed start body', async () => {
    const res = await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: authHeaders,
      payload: { spec: { streamId: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('drives failover through the internal ingest hooks', async () => {
    await engine.app.inject({
      method: 'POST',
      url: '/streams/start',
      headers: authHeaders,
      payload: { spec: streamSpec({ failover: { graceSeconds: 0 } }) },
    });

    // Connect the active ingest -> live.
    await engine.app.inject({
      method: 'POST',
      url: '/internal/ingest/ing-main/connect',
      headers: authHeaders,
      payload: { streamId: 'stream-1' },
    });

    // Disconnect -> with 0 grace, the engine cuts to failover immediately.
    await engine.app.inject({
      method: 'POST',
      url: '/internal/ingest/ing-main/disconnect',
      headers: authHeaders,
      payload: { streamId: 'stream-1' },
    });

    const runtime = await engine.app.inject({
      method: 'GET',
      url: '/streams/stream-1/runtime',
      headers: authHeaders,
    });
    expect(runtime.json<{ onFailover: boolean }>().onFailover).toBe(true);
  });

  describe('MediaMTX ingest hooks', () => {
    beforeEach(async () => {
      await engine.app.inject({
        method: 'POST',
        url: '/streams/start',
        headers: authHeaders,
        payload: { spec: streamSpec({ failover: { graceSeconds: 0 } }) },
      });
    });

    it('admits a publish whose path matches a live ingest key', async () => {
      const res = await engine.app.inject({
        method: 'POST',
        url: '/mediamtx/auth',
        headers: authHeaders,
        payload: { path: 'live/key-ing-main', action: 'publish' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ ingestId: string }>().ingestId).toBe('ing-main');
    });

    it('rejects a publish with an unknown stream key', async () => {
      const res = await engine.app.inject({
        method: 'POST',
        url: '/mediamtx/auth',
        headers: authHeaders,
        payload: { path: 'live/bogus-key', action: 'publish' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('always allows reads (playback / engine pull)', async () => {
      const res = await engine.app.inject({
        method: 'POST',
        url: '/mediamtx/auth',
        headers: authHeaders,
        payload: { path: 'live/anything', action: 'read' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('ready -> notready drives the failover state machine by path', async () => {
      await engine.app.inject({
        method: 'POST',
        url: '/mediamtx/ready',
        headers: authHeaders,
        payload: { path: 'live/key-ing-main' },
      });
      await engine.app.inject({
        method: 'POST',
        url: '/mediamtx/notready',
        headers: authHeaders,
        payload: { path: 'live/key-ing-main' },
      });
      const runtime = await engine.app.inject({
        method: 'GET',
        url: '/streams/stream-1/runtime',
        headers: authHeaders,
      });
      expect(runtime.json<{ onFailover: boolean }>().onFailover).toBe(true);
    });
  });
});

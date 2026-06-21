import { describe, expect, it, vi } from 'vitest';
import type { StreamId } from '@openrelay/core';
import { EngineClient } from './engine-client.js';
import { EngineRequestError } from './errors.js';

const STREAM_ID = 'stream_aaaaaaaa' as StreamId;

function client(fetchImpl: typeof fetch): EngineClient {
  return new EngineClient({ baseUrl: 'http://engine:8090', token: 't', fetch: fetchImpl });
}

describe('EngineClient.stopStream', () => {
  it('treats a 404 (session already gone) as success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'stream not running' }), { status: 404 }),
      ) as unknown as typeof fetch;
    await expect(client(fetchImpl).stopStream(STREAM_ID)).resolves.toBeUndefined();
  });

  it('still throws on other engine errors (e.g. 500)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(client(fetchImpl).stopStream(STREAM_ID)).rejects.toBeInstanceOf(
      EngineRequestError,
    );
  });

  it('resolves on a normal 200 stop', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ stopped: STREAM_ID }), { status: 200 }),
      ) as unknown as typeof fetch;
    await expect(client(fetchImpl).stopStream(STREAM_ID)).resolves.toBeUndefined();
  });
});

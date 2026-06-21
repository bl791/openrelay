import { describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';
import { buildClipObjectKey, createMediaStorage, sanitizeFilename } from './s3.js';

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
};

describe('sanitizeFilename', () => {
  it('lowercases and dasherizes unsafe characters', () => {
    expect(sanitizeFilename('My Cool Clip!.mp4')).toBe('my-cool-clip-.mp4');
  });

  it('falls back to a default for empty results', () => {
    expect(sanitizeFilename('***')).toBe('file');
  });
});

describe('buildClipObjectKey', () => {
  it('namespaces keys by stream and prefixes with the clip id', () => {
    const key = buildClipObjectKey('stream_abc', 'clip_xyz', 'Highlight Reel.mov');
    expect(key).toBe('clips/stream_abc/clip_xyz-highlight-reel.mov');
  });
});

describe('createMediaStorage', () => {
  it('exposes the configured media base URL', () => {
    const storage = createMediaStorage(config, { send: vi.fn() } as never);
    expect(storage.mediaBaseUrl).toBe('http://localhost:9000/openrelay-media');
  });

  it('swallows errors when deleting a missing object', async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error('not found')) };
    const storage = createMediaStorage(config, client as never);
    await expect(storage.deleteObject('clips/x/y.mp4')).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

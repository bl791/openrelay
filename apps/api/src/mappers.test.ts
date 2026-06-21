import { DEFAULT_FAILOVER_CONFIG, DEFAULT_OUTPUT_PROFILE, EngineStreamSpec } from '@openrelay/core';
import type { ClipRow, DestinationRow, IngestRow, SceneRow, StreamRow } from '@openrelay/db';
import { describe, expect, it } from 'vitest';
import {
  buildEngineStreamSpec,
  REDACTED_STREAM_KEY,
  toDestination,
  toIso,
  type StreamChildRows,
} from './mappers.js';

const now = '2026-06-18T00:00:00.000Z';

const streamRow: StreamRow = {
  id: 'stream_aaaaaaaa',
  ownerId: 'user_aaaaaaaa',
  title: 'My Stream',
  status: 'offline',
  output: DEFAULT_OUTPUT_PROFILE,
  failover: DEFAULT_FAILOVER_CONFIG,
  activeSceneId: 'scene_aaaaaaaa',
  createdAt: now,
  updatedAt: now,
};

const ingestRow: IngestRow = {
  id: 'ingest_aaaaaaaa',
  streamId: 'stream_aaaaaaaa',
  label: 'Primary',
  protocol: 'rtmp',
  streamKey: 'supersecretkey123',
  status: 'offline',
  isActive: true,
  ownerUserId: null,
  bitrateKbps: 0,
  lastSeenAt: null,
  createdAt: now,
};

const destinationRow: DestinationRow = {
  id: 'dest_aaaaaaaa',
  streamId: 'stream_aaaaaaaa',
  label: 'Twitch',
  platform: 'twitch',
  url: 'rtmp://live.twitch.tv/app',
  streamKey: 'live_dest_key',
  enabled: true,
  status: 'idle',
  createdAt: now,
};

const sceneRow: SceneRow = {
  id: 'scene_aaaaaaaa',
  streamId: 'stream_aaaaaaaa',
  label: 'Main',
  kind: 'ingest',
  ingestId: 'ingest_aaaaaaaa',
  assetUrl: null,
  clipId: null,
  color: null,
  position: 0,
};

const clipRow: ClipRow = {
  id: 'clip_aaaaaaaa',
  streamId: 'stream_aaaaaaaa',
  label: 'Highlight',
  objectKey: 'clips/stream_aaaaaaaa/clip_aaaaaaaa-highlight.mp4',
  contentType: 'video/mp4',
  sizeBytes: 1024,
  durationSeconds: 12,
  createdAt: now,
};

const mediaBaseUrl = 'http://localhost:9000/openrelay-media';

const rows: StreamChildRows = {
  stream: streamRow,
  ingests: [ingestRow],
  destinations: [destinationRow],
  scenes: [sceneRow],
  friends: [],
  clips: [clipRow],
};

describe('buildEngineStreamSpec', () => {
  it('maps DB rows to a valid EngineStreamSpec', () => {
    const spec = buildEngineStreamSpec(rows, mediaBaseUrl);
    // Round-trips through the core schema (throws if shape is wrong).
    expect(() => EngineStreamSpec.parse(spec)).not.toThrow();
    expect(spec.streamId).toBe('stream_aaaaaaaa');
    expect(spec.activeSceneId).toBe('scene_aaaaaaaa');
    expect(spec.ingests).toEqual([
      { id: 'ingest_aaaaaaaa', protocol: 'rtmp', streamKey: 'supersecretkey123' },
    ]);
  });

  it('includes destination stream keys (the engine needs them to push)', () => {
    const spec = buildEngineStreamSpec(rows, mediaBaseUrl);
    expect(spec.destinations[0]?.streamKey).toBe('live_dest_key');
  });

  it('preserves output and failover config verbatim', () => {
    const spec = buildEngineStreamSpec(rows, mediaBaseUrl);
    expect(spec.output).toEqual(DEFAULT_OUTPUT_PROFILE);
    expect(spec.failover).toEqual(DEFAULT_FAILOVER_CONFIG);
  });
});

describe('toDestination redaction', () => {
  it('redacts the stream key by default', () => {
    expect(toDestination(destinationRow).streamKey).toBe(REDACTED_STREAM_KEY);
  });

  it('includes the stream key only when explicitly requested', () => {
    expect(toDestination(destinationRow, true).streamKey).toBe('live_dest_key');
  });
});

describe('toIso', () => {
  // Postgres timestamptz serializes with a space separator and no `T`, e.g.
  // `2026-06-19 04:58:15.911648+00`, which fails Zod's strict `.datetime()`. The
  // mappers must canonicalize it to ISO-8601 so entity responses validate. (The
  // in-memory FakeDatabase already returned ISO strings, so only a real Postgres
  // surfaced this — hence an explicit regression test.)
  it('canonicalizes a Postgres timestamptz string to ISO-8601 with offset', () => {
    const iso = toIso('2026-06-19 04:58:15.911648+00');
    expect(iso).toBe('2026-06-19T04:58:15.911Z');
  });

  it('passes an already-ISO string through unchanged', () => {
    expect(toIso('2026-06-18T00:00:00.000Z')).toBe('2026-06-18T00:00:00.000Z');
  });

  it('produces output accepted by the Destination schema', () => {
    const dest = toDestination({ ...destinationRow, createdAt: '2026-06-19 04:58:15.911648+00' });
    expect(() => new Date(dest.createdAt).toISOString()).not.toThrow();
    expect(dest.createdAt).toBe('2026-06-19T04:58:15.911Z');
  });
});

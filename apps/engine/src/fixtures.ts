import type {
  Destination,
  EngineIngest,
  EngineStreamSpec,
  FailoverConfig,
  OutputProfile,
  Scene,
} from '@openrelay/core';

/**
 * Test fixtures. Branded ids are cast from plain strings; in production these
 * come from validated specs. Kept out of *.test.ts so multiple suites can share.
 */

type StreamId = EngineStreamSpec['streamId'];
type IngestId = EngineIngest['id'];
type SceneId = Scene['id'];
type DestinationId = Destination['id'];

export const OUTPUT: OutputProfile = {
  resolution: { width: 1920, height: 1080 },
  framerate: 60,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  preset: 'veryfast',
  keyframeIntervalSeconds: 2,
};

export function ingest(id: string, overrides: Partial<EngineIngest> = {}): EngineIngest {
  return {
    id: id as IngestId,
    protocol: 'rtmp',
    streamKey: `key-${id}`,
    ...overrides,
  };
}

export function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id: id as SceneId,
    streamId: 'stream-1' as StreamId,
    label: id,
    kind: 'brb',
    ingestId: null,
    assetUrl: null,
    clipId: null,
    color: '#101010',
    position: 0,
    ...overrides,
  };
}

export function destination(id: string, overrides: Partial<Destination> = {}): Destination {
  return {
    id: id as DestinationId,
    streamId: 'stream-1' as StreamId,
    label: id,
    platform: 'twitch',
    url: 'rtmp://live.twitch.tv/app',
    streamKey: `live_${id}`,
    enabled: true,
    status: 'idle',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface SpecOverrides {
  readonly failover?: Partial<FailoverConfig>;
  readonly ingests?: EngineIngest[];
  readonly destinations?: Destination[];
  readonly scenes?: Scene[];
  readonly activeSceneId?: string | null;
}

export function streamSpec(overrides: SpecOverrides = {}): EngineStreamSpec {
  const failover: FailoverConfig = {
    mode: 'brb',
    graceSeconds: 8,
    fallbackSceneId: null,
    ...overrides.failover,
  };
  return {
    streamId: 'stream-1' as StreamId,
    output: OUTPUT,
    failover,
    ingests: overrides.ingests ?? [ingest('ing-main'), ingest('ing-backup')],
    destinations: overrides.destinations ?? [destination('dst-twitch')],
    scenes: overrides.scenes ?? [scene('scene-brb', { kind: 'brb' })],
    activeSceneId: (overrides.activeSceneId ?? null) as EngineStreamSpec['activeSceneId'],
  };
}

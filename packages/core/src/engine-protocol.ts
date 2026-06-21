import { z } from 'zod';
import { Destination, FailoverConfig, OutputProfile, Scene } from './entities.js';
import { DestinationIdSchema, IngestIdSchema, SceneIdSchema, StreamIdSchema } from './ids.js';
import { DestinationStatus, IngestProtocol, IngestStatus, StreamStatus } from './enums.js';

/**
 * Control protocol spoken between the API control plane and the relay engine.
 * The engine owns FFmpeg processes; the API owns persistence and authorization.
 * Everything crossing the boundary is validated against these schemas.
 */

/** Description of an ingest endpoint the engine should listen on. */
export const EngineIngest = z.object({
  id: IngestIdSchema,
  protocol: IngestProtocol,
  streamKey: z.string(),
});
export type EngineIngest = z.infer<typeof EngineIngest>;

/**
 * Result of resolving an inbound publish path/stream-key (as seen by the ingest
 * media server) to a known ingest. The media server consults the engine before
 * admitting a publisher; the engine answers from its active session specs.
 */
export const ResolveIngestResult = z.object({
  allowed: z.boolean(),
  streamId: StreamIdSchema.nullable(),
  ingestId: IngestIdSchema.nullable(),
});
export type ResolveIngestResult = z.infer<typeof ResolveIngestResult>;

/**
 * MediaMTX authentication hook payload. MediaMTX POSTs this to the engine to
 * authorize a publish/read action; the engine grants publishes whose path matches
 * a live ingest's stream key.
 * @see https://github.com/bluenviron/mediamtx#authentication
 */
export const MediaServerAuthRequest = z.object({
  /** Stream path, which OpenRelay maps 1:1 to an ingest stream key. */
  path: z.string(),
  /** `publish` for an incoming source, `read` for playback. */
  action: z.string(),
  protocol: z.string().optional(),
  query: z.string().optional(),
});
export type MediaServerAuthRequest = z.infer<typeof MediaServerAuthRequest>;

/** Full broadcast specification handed to the engine when a stream starts. */
export const EngineStreamSpec = z.object({
  streamId: StreamIdSchema,
  output: OutputProfile,
  failover: FailoverConfig,
  ingests: z.array(EngineIngest),
  destinations: z.array(Destination),
  scenes: z.array(Scene),
  activeSceneId: SceneIdSchema.nullable(),
});
export type EngineStreamSpec = z.infer<typeof EngineStreamSpec>;

export const StartStreamRequest = z.object({ spec: EngineStreamSpec });
export type StartStreamRequest = z.infer<typeof StartStreamRequest>;

export const StopStreamRequest = z.object({ streamId: StreamIdSchema });
export type StopStreamRequest = z.infer<typeof StopStreamRequest>;

export const SwitchSceneRequest = z.object({
  streamId: StreamIdSchema,
  sceneId: SceneIdSchema,
});
export type SwitchSceneRequest = z.infer<typeof SwitchSceneRequest>;

export const SetActiveIngestRequest = z.object({
  streamId: StreamIdSchema,
  ingestId: IngestIdSchema,
});
export type SetActiveIngestRequest = z.infer<typeof SetActiveIngestRequest>;

/** Per-destination runtime status snapshot. */
export const DestinationRuntime = z.object({
  id: DestinationIdSchema,
  status: DestinationStatus,
  bitrateKbps: z.number().nonnegative(),
  error: z.string().nullable(),
});
export type DestinationRuntime = z.infer<typeof DestinationRuntime>;

/** Per-ingest runtime status snapshot. */
export const IngestRuntime = z.object({
  id: IngestIdSchema,
  status: IngestStatus,
  bitrateKbps: z.number().nonnegative(),
  isActive: z.boolean(),
});
export type IngestRuntime = z.infer<typeof IngestRuntime>;

/** Live telemetry for a running broadcast, polled or pushed to the control plane. */
export const StreamRuntime = z.object({
  streamId: StreamIdSchema,
  status: StreamStatus,
  activeSceneId: SceneIdSchema.nullable(),
  uptimeSeconds: z.number().nonnegative(),
  /** True while the relay is showing the failover scene rather than a live source. */
  onFailover: z.boolean(),
  ingests: z.array(IngestRuntime),
  destinations: z.array(DestinationRuntime),
});
export type StreamRuntime = z.infer<typeof StreamRuntime>;

/** Events the engine emits over the live event stream (SSE/WebSocket). */
export const EngineEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('runtime'), runtime: StreamRuntime }),
  z.object({
    type: z.literal('ingest_status'),
    streamId: StreamIdSchema,
    ingestId: IngestIdSchema,
    status: IngestStatus,
  }),
  z.object({
    type: z.literal('destination_status'),
    streamId: StreamIdSchema,
    destinationId: DestinationIdSchema,
    status: DestinationStatus,
    error: z.string().nullable(),
  }),
  z.object({
    type: z.literal('failover'),
    streamId: StreamIdSchema,
    active: z.boolean(),
  }),
  z.object({
    type: z.literal('scene_changed'),
    streamId: StreamIdSchema,
    sceneId: SceneIdSchema,
  }),
]);
export type EngineEvent = z.infer<typeof EngineEvent>;

/**
 * Status reconciliation callback the engine POSTs to the control-plane API so the
 * persisted DB state reflects reality (stream/ingest/destination status, failover,
 * active scene) rather than write-once defaults. Authenticated with the shared
 * engine token. The API applies the embedded {@link EngineEvent} to its tables.
 */
export const StatusCallback = z.object({
  event: EngineEvent,
});
export type StatusCallback = z.infer<typeof StatusCallback>;

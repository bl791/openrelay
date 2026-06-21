import {
  ClipIdSchema,
  DestinationIdSchema,
  EngineStreamSpec,
  FriendConnectionIdSchema,
  IngestIdSchema,
  SceneIdSchema,
  StreamIdSchema,
  UserIdSchema,
  type Clip,
  type Destination,
  type FriendConnection,
  type Ingest,
  type Scene,
  type Stream,
  type StreamWithChildren,
  type User,
} from '@openrelay/core';
import type {
  ClipRow,
  DestinationRow,
  FriendConnectionRow,
  IngestRow,
  SceneRow,
  StreamRow,
  UserRow,
} from '@openrelay/db';

/**
 * Pure mappers from Drizzle rows to `@openrelay/core` API entities. They are the
 * single boundary where persisted rows become typed domain objects; sensitive
 * fields (password hashes, destination stream keys) are redacted here.
 */

/**
 * Normalize a database timestamp to a strict ISO-8601 string with offset, which
 * is what the `@openrelay/core` entity schemas require. Postgres serializes
 * `timestamptz` as e.g. `2026-06-19 04:58:15.911648+00` (space separator, no `T`),
 * which fails Zod's `.datetime({ offset: true })`; `new Date(...).toISOString()`
 * canonicalizes both that form and already-ISO strings.
 */
export function toIso(value: string): string {
  return new Date(value).toISOString();
}

function toIsoOrNull(value: string | null): string | null {
  return value === null ? null : toIso(value);
}

export function toUser(row: UserRow): User {
  return {
    id: UserIdSchema.parse(row.id),
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toIngest(row: IngestRow): Ingest {
  return {
    id: IngestIdSchema.parse(row.id),
    streamId: StreamIdSchema.parse(row.streamId),
    label: row.label,
    protocol: row.protocol,
    streamKey: row.streamKey,
    status: row.status,
    isActive: row.isActive,
    ownerUserId: row.ownerUserId === null ? null : UserIdSchema.parse(row.ownerUserId),
    bitrateKbps: row.bitrateKbps,
    lastSeenAt: toIsoOrNull(row.lastSeenAt),
    createdAt: toIso(row.createdAt),
  };
}

/**
 * Browser-facing clip content URL. Media is proxied through the API so the client
 * only ever talks to the API origin it is authenticated against — it never needs
 * to reach the internal object store. Contrast with {@link internalClipUrl}, which
 * the in-network engine uses to read media directly from the store.
 */
export function clipContentUrl(apiPublicUrl: string, clipId: string): string {
  return `${apiPublicUrl.replace(/\/+$/, '')}/api/clips/${clipId}/content`;
}

/** Direct object-store URL the engine reads clip media from (in-network only). */
export function internalClipUrl(mediaBaseUrl: string, objectKey: string): string {
  return `${mediaBaseUrl.replace(/\/+$/, '')}/${objectKey}`;
}

/**
 * Resolve a clip row to the API entity. The `url` points at the API content proxy
 * (see {@link clipContentUrl}) so the dashboard can preview/play it directly.
 */
export function toClip(row: ClipRow, apiPublicUrl: string): Clip {
  return {
    id: ClipIdSchema.parse(row.id),
    streamId: StreamIdSchema.parse(row.streamId),
    label: row.label,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    durationSeconds: row.durationSeconds,
    url: clipContentUrl(apiPublicUrl, row.id),
    createdAt: toIso(row.createdAt),
  };
}

/**
 * Map a destination row to the API entity. Destination stream keys are
 * write-only in responses, so the key is redacted unless {@link includeSecret}
 * is explicitly set (e.g. immediately after creation).
 */
/**
 * Placeholder substituted for a destination stream key in any response where the
 * secret is redacted. The `Destination` schema requires a non-empty key, so this
 * sentinel both satisfies validation and unambiguously signals redaction.
 */
export const REDACTED_STREAM_KEY = '__redacted__';

export function toDestination(row: DestinationRow, includeSecret = false): Destination {
  return {
    id: DestinationIdSchema.parse(row.id),
    streamId: StreamIdSchema.parse(row.streamId),
    label: row.label,
    platform: row.platform,
    url: row.url,
    streamKey: includeSecret ? row.streamKey : REDACTED_STREAM_KEY,
    enabled: row.enabled,
    status: row.status,
    createdAt: toIso(row.createdAt),
  };
}

export function toScene(row: SceneRow, clipUrlById?: ReadonlyMap<string, string>): Scene {
  // A clips scene's playable URL comes from its referenced clip when set;
  // otherwise it falls back to any directly-configured asset URL.
  const clipUrl =
    row.clipId !== null && clipUrlById !== undefined ? (clipUrlById.get(row.clipId) ?? null) : null;
  return {
    id: SceneIdSchema.parse(row.id),
    streamId: StreamIdSchema.parse(row.streamId),
    label: row.label,
    kind: row.kind,
    ingestId: row.ingestId === null ? null : IngestIdSchema.parse(row.ingestId),
    assetUrl: clipUrl ?? row.assetUrl,
    clipId: row.clipId === null ? null : ClipIdSchema.parse(row.clipId),
    color: row.color,
    position: row.position,
  };
}

export function toFriend(row: FriendConnectionRow): FriendConnection {
  return {
    id: FriendConnectionIdSchema.parse(row.id),
    streamId: StreamIdSchema.parse(row.streamId),
    userId: UserIdSchema.parse(row.userId),
    role: row.role,
    createdAt: toIso(row.createdAt),
  };
}

export function toStream(row: StreamRow): Stream {
  return {
    id: StreamIdSchema.parse(row.id),
    ownerId: UserIdSchema.parse(row.ownerId),
    title: row.title,
    status: row.status,
    output: row.output,
    failover: row.failover,
    activeSceneId: row.activeSceneId === null ? null : SceneIdSchema.parse(row.activeSceneId),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export interface StreamChildRows {
  stream: StreamRow;
  ingests: IngestRow[];
  destinations: DestinationRow[];
  scenes: SceneRow[];
  friends: FriendConnectionRow[];
  clips: ClipRow[];
}

/** Browser-facing `clipId -> API proxy URL` lookup for resolving clips scenes. */
function browserClipUrlIndex(clips: ClipRow[], apiPublicUrl: string): Map<string, string> {
  return new Map(clips.map((c) => [c.id, clipContentUrl(apiPublicUrl, c.id)]));
}

/** Engine-facing `clipId -> internal object-store URL` lookup. */
function internalClipUrlIndex(clips: ClipRow[], mediaBaseUrl: string): Map<string, string> {
  return new Map(clips.map((c) => [c.id, internalClipUrl(mediaBaseUrl, c.objectKey)]));
}

export function toStreamWithChildren(
  rows: StreamChildRows,
  apiPublicUrl: string,
): StreamWithChildren {
  const clipUrls = browserClipUrlIndex(rows.clips, apiPublicUrl);
  return {
    ...toStream(rows.stream),
    ingests: rows.ingests.map((r) => toIngest(r)),
    destinations: rows.destinations.map((r) => toDestination(r)),
    scenes: rows.scenes.map((r) => toScene(r, clipUrls)),
    friends: rows.friends.map((r) => toFriend(r)),
    clips: rows.clips.map((r) => toClip(r, apiPublicUrl)),
  };
}

/**
 * Build the {@link EngineStreamSpec} the engine needs to start a broadcast from
 * the persisted DB rows. Pure mapping — no I/O — so it can be unit tested in
 * isolation. Destination stream keys are included because the engine needs them
 * to push; this spec never crosses the API/browser boundary.
 */
export function buildEngineStreamSpec(
  rows: StreamChildRows,
  mediaBaseUrl: string,
): EngineStreamSpec {
  // The engine reads media directly from the in-network object store.
  const clipUrls = internalClipUrlIndex(rows.clips, mediaBaseUrl);
  return EngineStreamSpec.parse({
    streamId: StreamIdSchema.parse(rows.stream.id),
    output: rows.stream.output,
    failover: rows.stream.failover,
    ingests: rows.ingests.map((r) => ({
      id: IngestIdSchema.parse(r.id),
      protocol: r.protocol,
      streamKey: r.streamKey,
    })),
    destinations: rows.destinations.map((r) => toDestination(r, true)),
    scenes: rows.scenes.map((r) => toScene(r, clipUrls)),
    activeSceneId:
      rows.stream.activeSceneId === null ? null : SceneIdSchema.parse(rows.stream.activeSceneId),
  });
}

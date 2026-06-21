import type { ClipRow, Database, IngestRow, StreamRow } from '@openrelay/db';
import { clips, destinations, friendConnections, ingests, scenes, streams } from '@openrelay/db';
import {
  DEFAULT_FAILOVER_CONFIG,
  DEFAULT_OUTPUT_PROFILE,
  OutputProfile,
  type DestinationStatus,
  type IngestProtocol,
  type IngestStatus,
  type SceneId,
  type StreamStatus,
} from '@openrelay/core';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { AppError } from './errors.js';
import { newSceneId, newStreamId, newIngestId, newStreamKey } from './ids.js';
import type { StreamChildRows } from './mappers.js';

/**
 * Load a stream together with all of its child rows in stable order. Throws a
 * 404 when the stream does not exist; callers are expected to have already
 * authorized access via {@link ./access.js}.
 */
export async function loadStreamChildRows(
  db: Database,
  streamId: string,
): Promise<StreamChildRows> {
  const [stream, ingestRows, destinationRows, sceneRows, friendRows, clipRows] = await Promise.all([
    db.query.streams.findFirst({ where: eq(streams.id, streamId) }),
    db.query.ingests.findMany({
      where: eq(ingests.streamId, streamId),
      orderBy: asc(ingests.createdAt),
    }),
    db.query.destinations.findMany({
      where: eq(destinations.streamId, streamId),
      orderBy: asc(destinations.createdAt),
    }),
    db.query.scenes.findMany({
      where: eq(scenes.streamId, streamId),
      orderBy: asc(scenes.position),
    }),
    db.query.friendConnections.findMany({
      where: eq(friendConnections.streamId, streamId),
      orderBy: asc(friendConnections.createdAt),
    }),
    db.query.clips.findMany({
      where: eq(clips.streamId, streamId),
      orderBy: asc(clips.createdAt),
    }),
  ]);

  if (!stream) {
    throw AppError.notFound('stream not found');
  }

  return {
    stream,
    ingests: ingestRows,
    destinations: destinationRows,
    scenes: sceneRows,
    friends: friendRows,
    clips: clipRows,
  };
}

// Streams --------------------------------------------------------------------

/** Optional partial output-profile overrides merged over {@link DEFAULT_OUTPUT_PROFILE}. */
type OutputOverrides = z.infer<ReturnType<typeof OutputProfile.partial>>;

/** Options for {@link createStreamWithDefaults}. */
export interface CreateStreamWithDefaultsArgs {
  ownerId: string;
  title: string;
  /** Optional partial overrides merged over {@link DEFAULT_OUTPUT_PROFILE}. */
  output?: OutputOverrides;
}

/**
 * Create a stream seeded with sensible defaults: the default output profile and
 * failover policy, plus a "Main" ingest scene and a "BRB" color scene, with the
 * Main scene set active. Shared by the create-stream route and the quickstart
 * flow so both seed identical defaults. Returns the persisted stream row.
 */
export async function createStreamWithDefaults(
  db: Database,
  args: CreateStreamWithDefaultsArgs,
): Promise<StreamRow> {
  const id = newStreamId();
  const output: OutputProfile = OutputProfile.parse({
    ...DEFAULT_OUTPUT_PROFILE,
    ...args.output,
  });
  const [streamRow] = await db
    .insert(streams)
    .values({
      id,
      ownerId: args.ownerId,
      title: args.title,
      status: 'offline',
      output,
      failover: DEFAULT_FAILOVER_CONFIG,
      activeSceneId: null,
    })
    .returning();
  if (!streamRow) {
    throw new AppError('internal_error', 'failed to create stream');
  }

  const mainSceneId = newSceneId();
  await db.insert(scenes).values({
    id: mainSceneId,
    streamId: id,
    label: 'Main',
    kind: 'ingest',
    ingestId: null,
    assetUrl: null,
    clipId: null,
    color: null,
    position: 0,
  });
  await db.insert(scenes).values({
    id: newSceneId(),
    streamId: id,
    label: 'BRB',
    kind: 'color',
    ingestId: null,
    assetUrl: null,
    clipId: null,
    color: '#111827',
    position: 1,
  });

  const [updated] = await db
    .update(streams)
    .set({ activeSceneId: mainSceneId })
    .where(eq(streams.id, id))
    .returning();
  return updated ?? streamRow;
}

// Ingests --------------------------------------------------------------------

/**
 * Insert a new ingest row with a freshly-generated secure stream key. When
 * {@link CreateSharedIngestArgs.ownerUserId} is set the ingest is a guest/shared
 * ingest owned by that collaborator; `null` means it belongs to the stream owner.
 */
export interface CreateSharedIngestArgs {
  streamId: string;
  label: string;
  protocol: IngestProtocol;
  /** Owning collaborator's user id, or `null` for a stream-owner ingest. */
  ownerUserId: string | null;
}

export async function provisionSharedIngest(
  db: Database,
  args: CreateSharedIngestArgs,
): Promise<IngestRow> {
  const [row] = await db
    .insert(ingests)
    .values({
      id: newIngestId(),
      streamId: args.streamId,
      label: args.label,
      protocol: args.protocol,
      streamKey: newStreamKey(),
      status: 'offline',
      isActive: false,
      ownerUserId: args.ownerUserId,
      bitrateKbps: 0,
      lastSeenAt: null,
    })
    .returning();
  if (!row) {
    throw new AppError('internal_error', 'failed to create ingest');
  }
  return row;
}

// Clips ----------------------------------------------------------------------

/** List a stream's media-library clips, oldest first. */
export function listClips(db: Database, streamId: string): Promise<ClipRow[]> {
  return db.query.clips.findMany({
    where: eq(clips.streamId, streamId),
    orderBy: asc(clips.createdAt),
  });
}

/** Fetch a single clip by id, or `undefined` when it does not exist. */
export function getClip(db: Database, clipId: string): Promise<ClipRow | undefined> {
  return db.query.clips.findFirst({ where: eq(clips.id, clipId) });
}

// Engine status reconciliation -----------------------------------------------

/**
 * Apply a stream-level status patch. All fields are optional so callers can
 * update only what an event carries. Unknown stream ids are silently ignored.
 */
export async function updateStreamStatus(
  db: Database,
  streamId: string,
  patch: { status?: StreamStatus; activeSceneId?: SceneId | null },
): Promise<void> {
  await db
    .update(streams)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.activeSceneId !== undefined ? { activeSceneId: patch.activeSceneId } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(streams.id, streamId));
}

/**
 * Upsert observed ingest telemetry. Scoped to the owning stream so a spoofed id
 * cannot touch another stream's rows. Unknown ids are silently ignored.
 */
export async function updateIngestStatus(
  db: Database,
  streamId: string,
  ingestId: string,
  patch: { status?: IngestStatus; bitrateKbps?: number; lastSeenAt?: string | null },
): Promise<void> {
  await db
    .update(ingests)
    .set({
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.bitrateKbps !== undefined ? { bitrateKbps: patch.bitrateKbps } : {}),
      ...(patch.lastSeenAt !== undefined ? { lastSeenAt: patch.lastSeenAt } : {}),
    })
    .where(and(eq(ingests.id, ingestId), eq(ingests.streamId, streamId)));
}

/** Update a destination's push status. Unknown ids are silently ignored. */
export async function updateDestinationStatus(
  db: Database,
  streamId: string,
  destinationId: string,
  status: DestinationStatus,
): Promise<void> {
  await db
    .update(destinations)
    .set({ status })
    .where(and(eq(destinations.id, destinationId), eq(destinations.streamId, streamId)));
}

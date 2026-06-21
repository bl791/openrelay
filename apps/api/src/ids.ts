import { createId } from '@paralleldrive/cuid2';
import {
  ClipIdSchema,
  DestinationIdSchema,
  FriendConnectionIdSchema,
  IngestIdSchema,
  SceneIdSchema,
  StreamIdSchema,
  UserIdSchema,
  type ClipId,
  type DestinationId,
  type FriendConnectionId,
  type IngestId,
  type SceneId,
  type StreamId,
  type UserId,
} from '@openrelay/core';

/**
 * URL-safe id generation. cuid2 produces lowercase alphanumeric ids that satisfy
 * the `cuidLike` schema in `@openrelay/core`; we re-validate through the branded
 * schemas so the nominal id types are produced at the single point of creation.
 */

export function newUserId(): UserId {
  return UserIdSchema.parse(createId());
}

export function newStreamId(): StreamId {
  return StreamIdSchema.parse(createId());
}

export function newIngestId(): IngestId {
  return IngestIdSchema.parse(createId());
}

export function newDestinationId(): DestinationId {
  return DestinationIdSchema.parse(createId());
}

export function newSceneId(): SceneId {
  return SceneIdSchema.parse(createId());
}

export function newClipId(): ClipId {
  return ClipIdSchema.parse(createId());
}

export function newFriendConnectionId(): FriendConnectionId {
  return FriendConnectionIdSchema.parse(createId());
}

/**
 * Generate a high-entropy, URL-safe stream key for an ingest endpoint. Two cuid2
 * ids concatenated give ~48 chars of entropy, comfortably inside the
 * 8..128 bound enforced by the {@link Ingest} schema.
 */
export function newStreamKey(): string {
  return `${createId()}${createId()}`;
}

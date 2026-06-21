import { z } from 'zod';

/**
 * Branded identifier helpers. Each entity gets a nominal string type so that, for
 * example, a {@link StreamId} cannot be passed where an {@link IngestId} is expected,
 * even though both are strings at runtime.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, 'UserId'>;
export type StreamId = Brand<string, 'StreamId'>;
export type IngestId = Brand<string, 'IngestId'>;
export type DestinationId = Brand<string, 'DestinationId'>;
export type SceneId = Brand<string, 'SceneId'>;
export type FriendConnectionId = Brand<string, 'FriendConnectionId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type SessionId = Brand<string, 'SessionId'>;

const cuidLike = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-z0-9_-]+$/i, 'must be a URL-safe identifier');

export const UserIdSchema = cuidLike.transform((v) => v as UserId);
export const StreamIdSchema = cuidLike.transform((v) => v as StreamId);
export const IngestIdSchema = cuidLike.transform((v) => v as IngestId);
export const DestinationIdSchema = cuidLike.transform((v) => v as DestinationId);
export const SceneIdSchema = cuidLike.transform((v) => v as SceneId);
export const FriendConnectionIdSchema = cuidLike.transform((v) => v as FriendConnectionId);
export const ClipIdSchema = cuidLike.transform((v) => v as ClipId);
export const SessionIdSchema = cuidLike.transform((v) => v as SessionId);

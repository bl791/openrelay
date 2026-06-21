import { z } from 'zod';

/** Ingest protocols a streamer can push their source feed into the relay with. */
export const IngestProtocol = z.enum(['rtmp', 'rtmps', 'srt']);
export type IngestProtocol = z.infer<typeof IngestProtocol>;

/** Live destination platforms / generic targets the relay fans out to. */
export const DestinationPlatform = z.enum(['twitch', 'kick', 'youtube', 'custom_rtmp']);
export type DestinationPlatform = z.infer<typeof DestinationPlatform>;

/**
 * Live connection status of an ingest as observed by the engine. `live` means a
 * source is actively pushing; `stale` means the feed dropped within the failover
 * grace window; `offline` means no source is connected.
 */
export const IngestStatus = z.enum(['offline', 'connecting', 'live', 'stale']);
export type IngestStatus = z.infer<typeof IngestStatus>;

/** Status of an outbound push to a single destination. */
export const DestinationStatus = z.enum(['idle', 'connecting', 'live', 'reconnecting', 'error']);
export type DestinationStatus = z.infer<typeof DestinationStatus>;

/**
 * High-level lifecycle of a broadcast. Once `live`, the viewer-facing output stays
 * up even when the active ingest is `stale` — that is the core drop-protection
 * guarantee.
 */
export const StreamStatus = z.enum(['offline', 'starting', 'live', 'failover', 'stopping']);
export type StreamStatus = z.infer<typeof StreamStatus>;

/**
 * What the relay should output when the active ingest drops:
 * - `brb`: switch to a configured BRB scene (static image / looping video).
 * - `clips`: play a clips reel until the source reconnects.
 * - `freeze`: hold the last good frame.
 */
export const FailoverMode = z.enum(['brb', 'clips', 'freeze']);
export type FailoverMode = z.infer<typeof FailoverMode>;

/** Kinds of scene a streamer can switch the broadcast to while live. */
export const SceneKind = z.enum(['ingest', 'brb', 'clips', 'image', 'color']);
export type SceneKind = z.infer<typeof SceneKind>;

/** Role of a friend/teammate granted access to remotely manage a stream. */
export const FriendRole = z.enum(['viewer', 'operator', 'manager']);
export type FriendRole = z.infer<typeof FriendRole>;

export const UserRole = z.enum(['admin', 'user']);
export type UserRole = z.infer<typeof UserRole>;

import { z } from 'zod';
import {
  ClipIdSchema,
  DestinationIdSchema,
  FriendConnectionIdSchema,
  IngestIdSchema,
  SceneIdSchema,
  StreamIdSchema,
  UserIdSchema,
} from './ids.js';
import {
  DestinationPlatform,
  DestinationStatus,
  FailoverMode,
  FriendRole,
  IngestProtocol,
  IngestStatus,
  SceneKind,
  StreamStatus,
  UserRole,
} from './enums.js';

const isoDate = z.string().datetime({ offset: true });

export const VideoResolution = z.object({
  width: z.number().int().min(160).max(7680),
  height: z.number().int().min(120).max(4320),
});
export type VideoResolution = z.infer<typeof VideoResolution>;

/** Encoder ladder for the stable, viewer-facing output the relay maintains. */
export const OutputProfile = z.object({
  resolution: VideoResolution,
  framerate: z.number().int().min(1).max(120),
  videoBitrateKbps: z.number().int().min(500).max(60_000),
  audioBitrateKbps: z.number().int().min(32).max(320),
  /** x264 preset trades CPU for compression efficiency. */
  preset: z.enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium']),
  keyframeIntervalSeconds: z.number().int().min(1).max(10),
});
export type OutputProfile = z.infer<typeof OutputProfile>;

export const User = z.object({
  id: UserIdSchema,
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  role: UserRole,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type User = z.infer<typeof User>;

export const Ingest = z.object({
  id: IngestIdSchema,
  streamId: StreamIdSchema,
  label: z.string().min(1).max(80),
  protocol: IngestProtocol,
  /** Opaque per-ingest stream key the source authenticates with. */
  streamKey: z.string().min(8).max(128),
  status: IngestStatus,
  /** Whether this is the ingest currently driving the broadcast. */
  isActive: z.boolean(),
  /**
   * Collaborator who owns this ingest, for shared/guest ingests. `null` means the
   * ingest belongs to the stream owner. A guest pushes their own feed into the
   * host's broadcast via this ingest's key.
   */
  ownerUserId: UserIdSchema.nullable(),
  /** Last observed ingest bitrate in kbps (0 when offline). */
  bitrateKbps: z.number().nonnegative(),
  lastSeenAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type Ingest = z.infer<typeof Ingest>;

export const Destination = z.object({
  id: DestinationIdSchema,
  streamId: StreamIdSchema,
  label: z.string().min(1).max(80),
  platform: DestinationPlatform,
  /** RTMP(S) ingest URL of the destination platform. */
  url: z.string().url(),
  /** Destination stream key (write-only in API responses). */
  streamKey: z.string().min(1).max(256),
  enabled: z.boolean(),
  status: DestinationStatus,
  createdAt: isoDate,
});
export type Destination = z.infer<typeof Destination>;

export const Scene = z.object({
  id: SceneIdSchema,
  streamId: StreamIdSchema,
  label: z.string().min(1).max(80),
  kind: SceneKind,
  /** For `ingest` scenes, which ingest to display. */
  ingestId: IngestIdSchema.nullable(),
  /** For `image`/`brb`/`clips` scenes, the media asset URL. */
  assetUrl: z.string().url().nullable(),
  /** For `clips` scenes, the clip from the media library this scene loops. */
  clipId: ClipIdSchema.nullable(),
  /** For `color` scenes, an `#rrggbb` background. */
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  position: z.number().int().min(0),
});
export type Scene = z.infer<typeof Scene>;

/** Where a clip's media originated. */
export const ClipSource = z.enum(['upload', 'twitch']);
export type ClipSource = z.infer<typeof ClipSource>;

/** A media asset (BRB image/video or clip reel) in a stream's media library. */
export const Clip = z.object({
  id: ClipIdSchema,
  streamId: StreamIdSchema,
  label: z.string().min(1).max(80),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  /** Whether the media was uploaded or imported from Twitch. */
  source: ClipSource,
  /** Upstream reference for imported clips (e.g. Twitch clip id), else null. */
  sourceRef: z.string().nullable(),
  /** Resolved URL the engine/player fetches the media from. */
  url: z.string().url(),
  createdAt: isoDate,
});
export type Clip = z.infer<typeof Clip>;

/** A user's linked Twitch account (no tokens are ever exposed to clients). */
export const TwitchConnection = z.object({
  twitchUserId: z.string(),
  twitchLogin: z.string(),
  scope: z.string(),
  connectedAt: isoDate,
});
export type TwitchConnection = z.infer<typeof TwitchConnection>;

export const FriendConnection = z.object({
  id: FriendConnectionIdSchema,
  streamId: StreamIdSchema,
  /** The user being granted access. */
  userId: UserIdSchema,
  role: FriendRole,
  createdAt: isoDate,
});
export type FriendConnection = z.infer<typeof FriendConnection>;

export const FailoverConfig = z.object({
  mode: FailoverMode,
  /**
   * How long an active ingest can stay dropped before the relay switches to the
   * failover scene. The viewer-facing broadcast never ends during this window.
   */
  graceSeconds: z.number().int().min(0).max(120),
  /** Scene to cut to during failover; null falls back to engine defaults. */
  fallbackSceneId: SceneIdSchema.nullable(),
});
export type FailoverConfig = z.infer<typeof FailoverConfig>;

export const Stream = z.object({
  id: StreamIdSchema,
  ownerId: UserIdSchema,
  title: z.string().min(1).max(140),
  status: StreamStatus,
  output: OutputProfile,
  failover: FailoverConfig,
  /** Scene currently shown to viewers. */
  activeSceneId: SceneIdSchema.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Stream = z.infer<typeof Stream>;

/** A fully-hydrated stream with its child resources, as returned by the detail API. */
export const StreamWithChildren = Stream.extend({
  ingests: z.array(Ingest),
  destinations: z.array(Destination),
  scenes: z.array(Scene),
  friends: z.array(FriendConnection),
  clips: z.array(Clip),
});
export type StreamWithChildren = z.infer<typeof StreamWithChildren>;

export const DEFAULT_OUTPUT_PROFILE: OutputProfile = {
  resolution: { width: 1920, height: 1080 },
  framerate: 60,
  videoBitrateKbps: 6000,
  audioBitrateKbps: 160,
  preset: 'veryfast',
  keyframeIntervalSeconds: 2,
};

export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  mode: 'brb',
  graceSeconds: 8,
  fallbackSceneId: null,
};

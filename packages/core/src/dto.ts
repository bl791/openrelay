import { z } from 'zod';
import { OutputProfile } from './entities.js';
import {
  DestinationPlatform,
  FailoverMode,
  FriendRole,
  IngestProtocol,
  SceneKind,
} from './enums.js';
import { ClipIdSchema, IngestIdSchema, SceneIdSchema } from './ids.js';

/** Data-transfer schemas for the REST control-plane API (request bodies). */

const password = z.string().min(10).max(200);

export const RegisterRequest = z.object({
  email: z.string().email(),
  password,
  displayName: z.string().min(1).max(80),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password,
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AuthResponse = z.object({
  token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    role: z.enum(['admin', 'user']),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const CreateStreamRequest = z.object({
  title: z.string().min(1).max(140),
  output: OutputProfile.partial().optional(),
});
export type CreateStreamRequest = z.infer<typeof CreateStreamRequest>;

export const UpdateStreamRequest = z
  .object({
    title: z.string().min(1).max(140),
    output: OutputProfile,
    failover: z.object({
      mode: FailoverMode,
      graceSeconds: z.number().int().min(0).max(120),
      fallbackSceneId: SceneIdSchema.nullable(),
    }),
  })
  .partial();
export type UpdateStreamRequest = z.infer<typeof UpdateStreamRequest>;

export const CreateIngestRequest = z.object({
  label: z.string().min(1).max(80),
  protocol: IngestProtocol,
});
export type CreateIngestRequest = z.infer<typeof CreateIngestRequest>;

export const CreateDestinationRequest = z.object({
  label: z.string().min(1).max(80),
  platform: DestinationPlatform,
  url: z.string().url(),
  streamKey: z.string().min(1).max(256),
  enabled: z.boolean().default(true),
});
export type CreateDestinationRequest = z.infer<typeof CreateDestinationRequest>;

export const UpdateDestinationRequest = CreateDestinationRequest.partial();
export type UpdateDestinationRequest = z.infer<typeof UpdateDestinationRequest>;

export const CreateSceneRequest = z.object({
  label: z.string().min(1).max(80),
  kind: SceneKind,
  ingestId: IngestIdSchema.nullable().default(null),
  assetUrl: z.string().url().nullable().default(null),
  clipId: ClipIdSchema.nullable().default(null),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .default(null),
});
export type CreateSceneRequest = z.infer<typeof CreateSceneRequest>;

export const AddFriendRequest = z.object({
  email: z.string().email(),
  role: FriendRole,
  /**
   * When true, also provision a dedicated guest ingest for this collaborator so
   * they can push their own feed into the host's broadcast.
   */
  provisionIngest: z.boolean().default(false),
});
export type AddFriendRequest = z.infer<typeof AddFriendRequest>;

/** Create a shared/guest ingest owned by a specific collaborator on a stream. */
export const CreateSharedIngestRequest = z.object({
  label: z.string().min(1).max(80),
  protocol: IngestProtocol,
  /** Collaborator (existing friend) who will own and push to this ingest. */
  ownerEmail: z.string().email(),
});
export type CreateSharedIngestRequest = z.infer<typeof CreateSharedIngestRequest>;

/** Register an uploaded media object as a clip in a stream's library. */
export const CreateClipRequest = z.object({
  label: z.string().min(1).max(80),
  objectKey: z.string().min(1).max(512),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().default(0),
  durationSeconds: z.number().int().nonnegative().nullable().default(null),
});
export type CreateClipRequest = z.infer<typeof CreateClipRequest>;

/** Request a presigned upload target for a clip/BRB media object. */
export const PresignUploadRequest = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
});
export type PresignUploadRequest = z.infer<typeof PresignUploadRequest>;

export const PresignUploadResponse = z.object({
  /** URL the client PUTs the file to. */
  uploadUrl: z.string().url(),
  /** Object key to pass back to {@link CreateClipRequest}. */
  objectKey: z.string(),
  /** Required HTTP method for the upload (typically `PUT`). */
  method: z.string(),
});
export type PresignUploadResponse = z.infer<typeof PresignUploadResponse>;

/** Connection details for a single ingest, ready to paste into an encoder. */
export const IngestConnectionInfo = z.object({
  ingestId: IngestIdSchema,
  label: z.string(),
  protocol: IngestProtocol,
  /** Server/URL field for OBS, Moblin, IRL Pro, etc. */
  server: z.string(),
  /** Stream key field. */
  streamKey: z.string(),
  /** Single-line URL convenient for SRT / quick paste. */
  url: z.string(),
});
export type IngestConnectionInfo = z.infer<typeof IngestConnectionInfo>;

/**
 * Everything a streamer needs to go live in one shot: the freshly-provisioned
 * stream plus copy-paste encoder settings and a mobile-friendly connect payload.
 */
export const QuickstartResponse = z.object({
  streamId: z.string(),
  title: z.string(),
  ingest: IngestConnectionInfo,
  /** Compact deep-link payload that mobile apps / QR codes can consume. */
  connectToken: z.string(),
});
export type QuickstartResponse = z.infer<typeof QuickstartResponse>;

export const QuickstartRequest = z.object({
  title: z.string().min(1).max(140).default('My Stream'),
  protocol: IngestProtocol.default('rtmp'),
});
export type QuickstartRequest = z.infer<typeof QuickstartRequest>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

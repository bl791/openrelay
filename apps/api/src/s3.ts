import {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { Config } from './config.js';

/**
 * Thin S3/MinIO client for the clips & BRB media library. Uploads and downloads
 * are proxied through the API ({@link putObject} / {@link getObject}) so the
 * browser never has to reach the object store directly — it only talks to the API
 * origin it is already authenticated against. A presigned PUT is still offered for
 * advanced/large direct-to-store uploads. Path-style addressing is forced because
 * MinIO does not support virtual-hosted-style buckets by default.
 */
export interface MediaStorage {
  /** Internal base URL objects are served from for the engine: `${publicUrl}/${bucket}`. */
  readonly mediaBaseUrl: string;
  /** Generate a presigned PUT URL a client may upload a single object to directly. */
  presignUpload(input: PresignUploadInput): Promise<string>;
  /** Upload an object's bytes through the API (server-side streaming to the store). */
  putObject(input: PutObjectInput): Promise<void>;
  /** Fetch an object's bytes + content type for proxying back to the browser. */
  getObject(objectKey: string): Promise<MediaObject>;
  /** Best-effort delete of a stored object; resolves even when it does not exist. */
  deleteObject(objectKey: string): Promise<void>;
}

export interface PresignUploadInput {
  key: string;
  contentType: string;
  /** Presigned URL lifetime in seconds (default 15 minutes). */
  expiresInSeconds?: number;
}

export interface PutObjectInput {
  key: string;
  contentType: string;
  body: Buffer;
}

export interface MediaObject {
  body: Readable;
  contentType: string;
  contentLength: number | undefined;
}

const DEFAULT_EXPIRY_SECONDS = 900;

/**
 * Build an object key for an uploaded clip, namespaced by stream and prefixed
 * with the clip id so keys are unique and never collide. The original filename is
 * sanitized down to a safe slug for readability only.
 */
export function buildClipObjectKey(streamId: string, clipId: string, filename: string): string {
  return `clips/${streamId}/${clipId}-${sanitizeFilename(filename)}`;
}

/** Reduce an arbitrary filename to a safe, lowercase, dash-separated slug. */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Construct the S3 client used by {@link createMediaStorage} for MinIO/S3. */
export function createS3Client(config: Config): S3Client {
  return new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.s3.accessKey,
      secretAccessKey: config.s3.secretKey,
    },
  });
}

/**
 * Create the {@link MediaStorage} the app decorates onto `app.s3`. The S3 client
 * is injectable so tests can pass a stub and assert key generation without
 * touching the network.
 */
export function createMediaStorage(
  config: Config,
  client: S3Client = createS3Client(config),
): MediaStorage {
  return {
    mediaBaseUrl: config.s3.mediaBaseUrl,
    async presignUpload(input: PresignUploadInput): Promise<string> {
      const command = new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: input.key,
        ContentType: input.contentType,
      });
      return getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
      });
    },
    async putObject(input: PutObjectInput): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: input.key,
          ContentType: input.contentType,
          Body: input.body,
          ContentLength: input.body.byteLength,
        }),
      );
    },
    async getObject(objectKey: string): Promise<MediaObject> {
      const result = await client.send(
        new GetObjectCommand({ Bucket: config.s3.bucket, Key: objectKey }),
      );
      if (result.Body === undefined) {
        throw new Error(`object ${objectKey} has no body`);
      }
      return {
        body: result.Body as Readable,
        contentType: result.ContentType ?? 'application/octet-stream',
        contentLength: result.ContentLength,
      };
    },
    async deleteObject(objectKey: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: objectKey }));
      } catch {
        // Best-effort cleanup: a missing object or transient error must not fail
        // the control-plane delete that the user already authorized.
      }
    },
  };
}

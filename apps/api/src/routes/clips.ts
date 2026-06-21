import {
  Clip,
  CreateClipRequest,
  PresignUploadRequest,
  PresignUploadResponse,
} from '@openrelay/core';
import { clips } from '@openrelay/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl } from '../access.js';
import { AppError } from '../errors.js';
import { newClipId } from '../ids.js';
import { toClip } from '../mappers.js';
import { getClip, listClips } from '../repository.js';
import { buildClipObjectKey } from '../s3.js';
import { ClipIdParams, StreamIdParams } from './schemas.js';

/**
 * Clips & BRB media-library management. The primary upload path proxies bytes
 * through the API (browser → API → object store) so the browser only ever talks
 * to this origin; a presigned PUT is also offered for direct-to-store uploads.
 * Clip content is served back through the API content proxy as well.
 */
export function registerClipRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  // Proxy upload: accept a multipart file, stream it into the object store, and
  // register the clip in one round-trip. This is what the dashboard uses.
  app.post('/streams/:id/clips/upload', auth, async (request, reply) => {
    const params = StreamIdParams.parse(request.params);
    const access = await loadStreamForUser(app.db, params.id, request.user);
    requireControl(access);

    const file = await request.file();
    if (!file) {
      throw new AppError('validation_error', 'a file field is required');
    }
    const label = readLabelField(file.fields) ?? file.filename;
    const contentType = file.mimetype || 'application/octet-stream';
    const buffer = await file.toBuffer();

    const id = newClipId();
    const objectKey = buildClipObjectKey(access.stream.id, id, file.filename);
    await app.s3.putObject({ key: objectKey, contentType, body: buffer });

    const [row] = await app.db
      .insert(clips)
      .values({
        id,
        streamId: access.stream.id,
        label,
        objectKey,
        contentType,
        sizeBytes: buffer.byteLength,
        durationSeconds: null,
        source: 'upload',
        sourceRef: null,
      })
      .returning();
    if (!row) {
      throw new AppError('internal_error', 'failed to register uploaded clip');
    }
    return reply.code(201).send(toClip(row, app.config.apiPublicUrl));
  });

  // Content proxy: stream a clip's bytes back to the browser/player. Public (no
  // auth) so it works directly in <img>/<video> src; object keys are unguessable
  // cuids namespaced per stream.
  app.get('/clips/:clipId/content', async (request, reply) => {
    const { clipId } = ClipIdParams.parse(request.params);
    const clip = await getClip(app.db, clipId);
    if (!clip) {
      throw AppError.notFound('clip not found');
    }
    const object = await app.s3.getObject(clip.objectKey);
    void reply.header('content-type', object.contentType);
    if (object.contentLength !== undefined) {
      void reply.header('content-length', object.contentLength);
    }
    void reply.header('cache-control', 'public, max-age=300');
    return reply.send(object.body);
  });

  // Mint a presigned PUT URL plus the object key to register afterwards.
  r.post(
    '/streams/:id/clips/presign',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: PresignUploadRequest,
        response: { 200: PresignUploadResponse },
      },
    },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const objectKey = buildClipObjectKey(access.stream.id, newClipId(), request.body.filename);
      const uploadUrl = await app.s3.presignUpload({
        key: objectKey,
        contentType: request.body.contentType,
      });
      return { uploadUrl, objectKey, method: 'PUT' };
    },
  );

  // Register a previously-uploaded object as a clip in the library.
  r.post(
    '/streams/:id/clips',
    {
      ...auth,
      schema: { params: StreamIdParams, body: CreateClipRequest, response: { 201: Clip } },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const id = newClipId();
      const [row] = await app.db
        .insert(clips)
        .values({
          id,
          streamId: access.stream.id,
          label: request.body.label,
          objectKey: request.body.objectKey,
          contentType: request.body.contentType,
          sizeBytes: request.body.sizeBytes,
          durationSeconds: request.body.durationSeconds,
          source: 'upload',
          sourceRef: null,
        })
        .returning();
      if (!row) {
        throw new AppError('internal_error', 'failed to register clip');
      }
      return reply.code(201).send(toClip(row, app.config.apiPublicUrl));
    },
  );

  // List a stream's clips.
  r.get(
    '/streams/:id/clips',
    { ...auth, schema: { params: StreamIdParams, response: { 200: z.array(Clip) } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      const rows = await listClips(app.db, access.stream.id);
      return rows.map((row) => toClip(row, app.config.apiPublicUrl));
    },
  );

  // Delete a clip and best-effort remove its backing object.
  r.delete(
    '/clips/:clipId',
    { ...auth, schema: { params: ClipIdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const clip = await getClip(app.db, request.params.clipId);
      if (!clip) {
        throw AppError.notFound('clip not found');
      }
      const access = await loadStreamForUser(app.db, clip.streamId, request.user);
      requireControl(access);
      await app.db.delete(clips).where(eq(clips.id, clip.id));
      await app.s3.deleteObject(clip.objectKey);
      return reply.code(204).send(null);
    },
  );
}

/**
 * Extract an optional `label` text field from a multipart request's parsed fields.
 * `@fastify/multipart` types fields loosely, so we narrow defensively.
 */
function readLabelField(fields: unknown): string | null {
  if (fields === null || typeof fields !== 'object' || !('label' in fields)) {
    return null;
  }
  const label: unknown = (fields as Record<string, unknown>).label;
  if (label !== null && typeof label === 'object' && 'value' in label) {
    const value: unknown = label.value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

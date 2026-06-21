import { CreateSceneRequest, Scene } from '@openrelay/core';
import { clips, scenes } from '@openrelay/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl } from '../access.js';
import { AppError } from '../errors.js';
import { newSceneId } from '../ids.js';
import { clipContentUrl, toScene } from '../mappers.js';
import { SceneIdParams, StreamIdParams } from './schemas.js';

/** Scene management for a stream. */
export function registerSceneRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.post(
    '/streams/:id/scenes',
    {
      ...auth,
      schema: { params: StreamIdParams, body: CreateSceneRequest, response: { 201: Scene } },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      // When a scene references a library clip, validate it belongs to this
      // stream and surface its public URL on the response.
      let clipUrls: Map<string, string> | undefined;
      if (request.body.clipId !== null) {
        const clip = await app.db.query.clips.findFirst({
          where: and(eq(clips.id, request.body.clipId), eq(clips.streamId, access.stream.id)),
        });
        if (!clip) {
          throw AppError.notFound('clip not found on this stream');
        }
        clipUrls = new Map([[clip.id, clipContentUrl(app.config.apiPublicUrl, clip.id)]]);
      }
      const last = await app.db.query.scenes.findMany({
        where: eq(scenes.streamId, access.stream.id),
        orderBy: asc(scenes.position),
      });
      const position = last.reduce((max, s) => Math.max(max, s.position + 1), 0);
      const id = newSceneId();
      const [row] = await app.db
        .insert(scenes)
        .values({
          id,
          streamId: access.stream.id,
          label: request.body.label,
          kind: request.body.kind,
          ingestId: request.body.ingestId,
          assetUrl: request.body.assetUrl,
          clipId: request.body.clipId,
          color: request.body.color,
          position,
        })
        .returning();
      if (!row) {
        throw new AppError('internal_error', 'failed to create scene');
      }
      return reply.code(201).send(toScene(row, clipUrls));
    },
  );

  r.delete(
    '/scenes/:id',
    { ...auth, schema: { params: SceneIdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const existing = await app.db.query.scenes.findFirst({
        where: eq(scenes.id, request.params.id),
      });
      if (!existing) {
        throw AppError.notFound('scene not found');
      }
      const access = await loadStreamForUser(app.db, existing.streamId, request.user);
      requireControl(access);
      await app.db.delete(scenes).where(eq(scenes.id, existing.id));
      return reply.code(204).send(null);
    },
  );
}

import { CreateDestinationRequest, Destination, UpdateDestinationRequest } from '@openrelay/core';
import { destinations } from '@openrelay/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl } from '../access.js';
import { AppError } from '../errors.js';
import { newDestinationId } from '../ids.js';
import { toDestination } from '../mappers.js';
import { DestinationIdParams, StreamIdParams } from './schemas.js';

/** Destination (multistream target) management. Stream keys are write-only. */
export function registerDestinationRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.post(
    '/streams/:id/destinations',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: CreateDestinationRequest,
        response: { 201: Destination },
      },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const id = newDestinationId();
      const [row] = await app.db
        .insert(destinations)
        .values({
          id,
          streamId: access.stream.id,
          label: request.body.label,
          platform: request.body.platform,
          url: request.body.url,
          streamKey: request.body.streamKey,
          enabled: request.body.enabled,
          status: 'idle',
        })
        .returning();
      if (!row) {
        throw new AppError('internal_error', 'failed to create destination');
      }
      // Echo the secret back once on creation so the client can confirm it.
      return reply.code(201).send(toDestination(row, true));
    },
  );

  r.patch(
    '/destinations/:id',
    {
      ...auth,
      schema: {
        params: DestinationIdParams,
        body: UpdateDestinationRequest,
        response: { 200: Destination },
      },
    },
    async (request) => {
      const existing = await app.db.query.destinations.findFirst({
        where: eq(destinations.id, request.params.id),
      });
      if (!existing) {
        throw AppError.notFound('destination not found');
      }
      const access = await loadStreamForUser(app.db, existing.streamId, request.user);
      requireControl(access);
      const patch = request.body;
      const [row] = await app.db
        .update(destinations)
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.platform !== undefined ? { platform: patch.platform } : {}),
          ...(patch.url !== undefined ? { url: patch.url } : {}),
          ...(patch.streamKey !== undefined ? { streamKey: patch.streamKey } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        })
        .where(eq(destinations.id, existing.id))
        .returning();
      if (!row) {
        throw AppError.notFound('destination not found');
      }
      return toDestination(row);
    },
  );

  r.delete(
    '/destinations/:id',
    { ...auth, schema: { params: DestinationIdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const existing = await app.db.query.destinations.findFirst({
        where: eq(destinations.id, request.params.id),
      });
      if (!existing) {
        throw AppError.notFound('destination not found');
      }
      const access = await loadStreamForUser(app.db, existing.streamId, request.user);
      requireControl(access);
      await app.db.delete(destinations).where(eq(destinations.id, existing.id));
      return reply.code(204).send(null);
    },
  );
}

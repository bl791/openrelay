import { StatusCallback, type EngineEvent } from '@openrelay/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { updateDestinationStatus, updateIngestStatus, updateStreamStatus } from '../repository.js';

/**
 * Internal routes the relay engine calls to reconcile persisted state with the
 * live broadcast. Authenticated with the shared engine token (NOT a user JWT),
 * so these live outside the `/api` prefix and the JWT auth plugin.
 */
export function registerInternalRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const requireEngineToken = async (
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> => {
    const header = request.headers.authorization ?? '';
    const expected = `Bearer ${app.config.engineToken}`;
    if (header !== expected) {
      throw AppError.unauthorized('invalid engine token');
    }
    return Promise.resolve();
  };

  r.post(
    '/internal/engine/status',
    {
      preHandler: requireEngineToken,
      schema: { body: StatusCallback, response: { 204: z.null() } },
    },
    async (request, reply) => {
      await applyEngineEvent(app, request.body.event);
      return reply.code(204).send(null);
    },
  );
}

/**
 * Apply a single {@link EngineEvent} to the database. Every write is scoped to
 * the event's stream and tolerant of unknown ids, so a stale or partial event
 * can never throw or touch unrelated rows.
 */
async function applyEngineEvent(app: FastifyInstance, event: EngineEvent): Promise<void> {
  switch (event.type) {
    case 'runtime': {
      const { runtime } = event;
      await updateStreamStatus(app.db, runtime.streamId, {
        status: runtime.status,
        activeSceneId: runtime.activeSceneId,
      });
      await Promise.all([
        ...runtime.ingests.map((ingest) =>
          updateIngestStatus(app.db, runtime.streamId, ingest.id, {
            status: ingest.status,
            bitrateKbps: ingest.bitrateKbps,
            ...(ingest.status === 'live' ? { lastSeenAt: new Date().toISOString() } : {}),
          }),
        ),
        ...runtime.destinations.map((destination) =>
          updateDestinationStatus(app.db, runtime.streamId, destination.id, destination.status),
        ),
      ]);
      return;
    }
    case 'ingest_status': {
      await updateIngestStatus(app.db, event.streamId, event.ingestId, {
        status: event.status,
        ...(event.status === 'live' ? { lastSeenAt: new Date().toISOString() } : {}),
      });
      return;
    }
    case 'destination_status': {
      await updateDestinationStatus(app.db, event.streamId, event.destinationId, event.status);
      return;
    }
    case 'failover': {
      await updateStreamStatus(app.db, event.streamId, {
        status: event.active ? 'failover' : 'live',
      });
      return;
    }
    case 'scene_changed': {
      await updateStreamStatus(app.db, event.streamId, { activeSceneId: event.sceneId });
      return;
    }
  }
}

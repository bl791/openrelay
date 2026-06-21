import {
  CreateIngestRequest,
  CreateSharedIngestRequest,
  Ingest,
  IngestConnectionInfo,
} from '@openrelay/core';
import { friendConnections, ingests, users } from '@openrelay/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl, requireManage } from '../access.js';
import { AppError } from '../errors.js';
import { provisionSharedIngest } from '../repository.js';
import { buildIngestConnectionInfo, buildPushUrl } from '../ingest-url.js';
import { toIngest } from '../mappers.js';
import { IngestIdParams, StreamIdParams } from './schemas.js';

/** Response for ingest creation: the entity plus the encoder publish URL. */
const CreateIngestResponse = Ingest.extend({ pushUrl: z.string() });

/** Response for a shared/guest ingest: the entity plus copy-paste connection info. */
const CreateSharedIngestResponse = Ingest.extend({ connection: IngestConnectionInfo });

/** Ingest endpoint management, including per-collaborator shared (guest) ingests. */
export function registerIngestRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.post(
    '/streams/:id/ingests',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: CreateIngestRequest,
        response: { 201: CreateIngestResponse },
      },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const row = await provisionSharedIngest(app.db, {
        streamId: access.stream.id,
        label: request.body.label,
        protocol: request.body.protocol,
        ownerUserId: null,
      });
      const pushUrl = buildPushUrl(app.config, row.protocol, row.streamKey);
      return reply.code(201).send({ ...toIngest(row), pushUrl });
    },
  );

  // Provision a dedicated guest ingest owned by an existing collaborator so they
  // can push their own source feed into the host's broadcast. Owner/manager only.
  r.post(
    '/streams/:id/shared-ingests',
    {
      ...auth,
      schema: {
        params: StreamIdParams,
        body: CreateSharedIngestRequest,
        response: { 201: CreateSharedIngestResponse },
      },
    },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireManage(access);

      const guestUser = await app.db.query.users.findFirst({
        where: eq(users.email, request.body.ownerEmail),
      });
      if (!guestUser) {
        throw AppError.notFound('no user with that email');
      }
      // The guest must already be a collaborator on this stream (or its owner).
      if (guestUser.id !== access.stream.ownerId) {
        const friend = await app.db.query.friendConnections.findFirst({
          where: and(
            eq(friendConnections.streamId, access.stream.id),
            eq(friendConnections.userId, guestUser.id),
          ),
        });
        if (!friend) {
          throw new AppError(
            'validation_error',
            'that user must be a collaborator on this stream first',
          );
        }
      }

      const row = await provisionSharedIngest(app.db, {
        streamId: access.stream.id,
        label: request.body.label,
        protocol: request.body.protocol,
        ownerUserId: guestUser.id,
      });
      const connection = buildIngestConnectionInfo(app.config, {
        id: toIngest(row).id,
        label: row.label,
        protocol: row.protocol,
        streamKey: row.streamKey,
      });
      return reply.code(201).send({ ...toIngest(row), connection });
    },
  );

  r.delete(
    '/ingests/:id',
    { ...auth, schema: { params: IngestIdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const ingest = await app.db.query.ingests.findFirst({
        where: eq(ingests.id, request.params.id),
      });
      if (!ingest) {
        throw AppError.notFound('ingest not found');
      }
      const access = await loadStreamForUser(app.db, ingest.streamId, request.user);
      // The stream owner/manager may remove any ingest; a guest may remove their own.
      const isOwnIngest = ingest.ownerUserId === request.user.id;
      if (!isOwnIngest) {
        requireManage(access);
      }
      await app.db.delete(ingests).where(eq(ingests.id, ingest.id));
      return reply.code(204).send(null);
    },
  );
}

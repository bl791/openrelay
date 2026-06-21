import { IngestConnectionInfo, QuickstartRequest, QuickstartResponse } from '@openrelay/core';
import { ingests } from '@openrelay/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadStreamForUser } from '../access.js';
import { encodeConnectToken } from '../connect-token.js';
import { AppError } from '../errors.js';
import { buildIngestConnectionInfo } from '../ingest-url.js';
import { toIngest } from '../mappers.js';
import { createStreamWithDefaults, provisionSharedIngest } from '../repository.js';
import { StreamIdParams } from './schemas.js';

/**
 * Quickstart / easy-connect: one action that provisions a ready-to-stream setup
 * (stream + default scenes + primary ingest) and returns copy-paste encoder
 * settings plus a mobile-friendly connect payload. Plus a per-stream connection
 * lookup so the dashboard can show easy-connect settings for existing streams.
 */
export function registerQuickstartRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  r.post(
    '/quickstart',
    { ...auth, schema: { body: QuickstartRequest, response: { 201: QuickstartResponse } } },
    async (request, reply) => {
      const streamRow = await createStreamWithDefaults(app.db, {
        ownerId: request.user.id,
        title: request.body.title,
      });

      const ingestRow = await provisionSharedIngest(app.db, {
        streamId: streamRow.id,
        label: 'Main',
        protocol: request.body.protocol,
        ownerUserId: null,
      });

      const ingest = buildIngestConnectionInfo(app.config, {
        id: toIngest(ingestRow).id,
        label: ingestRow.label,
        protocol: ingestRow.protocol,
        streamKey: ingestRow.streamKey,
      });

      const connectToken = encodeConnectToken({
        v: 1,
        streamId: streamRow.id,
        protocol: ingest.protocol,
        server: ingest.server,
        streamKey: ingest.streamKey,
      });

      return reply.code(201).send({
        streamId: streamRow.id,
        title: streamRow.title,
        ingest,
        connectToken,
      } satisfies QuickstartResponse);
    },
  );

  // Copy-paste connection info for an existing stream's primary (owner-owned,
  // first-created) ingest, so the dashboard can render an easy-connect panel.
  r.get(
    '/streams/:id/connection',
    { ...auth, schema: { params: StreamIdParams, response: { 200: IngestConnectionInfo } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      const ingestRows = await app.db.query.ingests.findMany({
        where: eq(ingests.streamId, access.stream.id),
        orderBy: asc(ingests.createdAt),
      });
      const primary = ingestRows.find((row) => row.ownerUserId === null) ?? ingestRows[0];
      if (!primary) {
        throw AppError.notFound('this stream has no ingest yet');
      }
      return buildIngestConnectionInfo(app.config, {
        id: toIngest(primary).id,
        label: primary.label,
        protocol: primary.protocol,
        streamKey: primary.streamKey,
      });
    },
  );
}

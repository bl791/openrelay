import {
  CreateStreamRequest,
  Stream,
  StreamRuntime,
  StreamWithChildren,
  UpdateStreamRequest,
} from '@openrelay/core';
import { friendConnections, ingests, scenes, streams } from '@openrelay/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { loadStreamForUser, requireControl, requireOwner } from '../access.js';
import { AppError } from '../errors.js';
import { buildEngineStreamSpec, toStream, toStreamWithChildren } from '../mappers.js';
import { createStreamWithDefaults, loadStreamChildRows } from '../repository.js';
import { SetIngestBody, StreamIdParams, SwitchSceneBody } from './schemas.js';

/** Stream CRUD plus engine-orchestration routes. All require authentication. */
export function registerStreamRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  // List streams owned by, or shared with, the caller.
  r.get(
    '/streams',
    { ...auth, schema: { response: { 200: z.array(Stream) } } },
    async (request) => {
      const owned = await app.db.query.streams.findMany({
        where: eq(streams.ownerId, request.user.id),
        orderBy: asc(streams.createdAt),
      });
      const shares = await app.db.query.friendConnections.findMany({
        where: eq(friendConnections.userId, request.user.id),
      });
      const sharedIds = shares.map((s) => s.streamId).filter((id) => id.length > 0);
      const shared =
        sharedIds.length > 0
          ? await app.db.query.streams.findMany({ where: inArray(streams.id, sharedIds) })
          : [];
      const all = [...owned, ...shared];
      return all.map((row) => toStream(row));
    },
  );

  // Create a stream, seeding default output/failover config and a Main scene.
  r.post(
    '/streams',
    { ...auth, schema: { body: CreateStreamRequest, response: { 201: StreamWithChildren } } },
    async (request, reply) => {
      const streamRow = await createStreamWithDefaults(app.db, {
        ownerId: request.user.id,
        title: request.body.title,
        ...(request.body.output ? { output: request.body.output } : {}),
      });
      const rows = await loadStreamChildRows(app.db, streamRow.id);
      return reply.code(201).send(toStreamWithChildren(rows, app.config.apiPublicUrl));
    },
  );

  r.get(
    '/streams/:id',
    { ...auth, schema: { params: StreamIdParams, response: { 200: StreamWithChildren } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      const rows = await loadStreamChildRows(app.db, access.stream.id);
      return toStreamWithChildren(rows, app.config.apiPublicUrl);
    },
  );

  r.patch(
    '/streams/:id',
    {
      ...auth,
      schema: { params: StreamIdParams, body: UpdateStreamRequest, response: { 200: Stream } },
    },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const patch = request.body;
      const [row] = await app.db
        .update(streams)
        .set({
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.output !== undefined ? { output: patch.output } : {}),
          ...(patch.failover !== undefined ? { failover: patch.failover } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(streams.id, access.stream.id))
        .returning();
      if (!row) {
        throw AppError.notFound('stream not found');
      }
      return toStream(row);
    },
  );

  r.delete(
    '/streams/:id',
    { ...auth, schema: { params: StreamIdParams, response: { 204: z.null() } } },
    async (request, reply) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireOwner(access);
      await app.db.delete(streams).where(eq(streams.id, access.stream.id));
      return reply.code(204).send(null);
    },
  );

  // Engine orchestration ------------------------------------------------------

  r.post(
    '/streams/:id/start',
    { ...auth, schema: { params: StreamIdParams, response: { 200: StreamRuntime } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const rows = await loadStreamChildRows(app.db, access.stream.id);
      const spec = buildEngineStreamSpec(rows, app.s3.mediaBaseUrl);
      const runtime = await app.engine.startStream(spec);
      await app.db
        .update(streams)
        .set({ status: 'starting', updatedAt: new Date().toISOString() })
        .where(eq(streams.id, access.stream.id));
      return runtime;
    },
  );

  r.post(
    '/streams/:id/stop',
    { ...auth, schema: { params: StreamIdParams, response: { 200: Stream } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      await app.engine.stopStream(toStream(access.stream).id);
      const [row] = await app.db
        .update(streams)
        .set({ status: 'offline', updatedAt: new Date().toISOString() })
        .where(eq(streams.id, access.stream.id))
        .returning();
      if (!row) {
        throw AppError.notFound('stream not found');
      }
      return toStream(row);
    },
  );

  r.post(
    '/streams/:id/scene',
    {
      ...auth,
      schema: { params: StreamIdParams, body: SwitchSceneBody, response: { 200: StreamRuntime } },
    },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const scene = await app.db.query.scenes.findFirst({
        where: eq(scenes.id, request.body.sceneId),
      });
      if (scene?.streamId !== access.stream.id) {
        throw AppError.notFound('scene not found on this stream');
      }
      const runtime = await app.engine.switchScene(
        toStream(access.stream).id,
        request.body.sceneId,
      );
      await app.db
        .update(streams)
        .set({ activeSceneId: request.body.sceneId, updatedAt: new Date().toISOString() })
        .where(eq(streams.id, access.stream.id));
      return runtime;
    },
  );

  r.post(
    '/streams/:id/ingest',
    {
      ...auth,
      schema: { params: StreamIdParams, body: SetIngestBody, response: { 200: StreamRuntime } },
    },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      requireControl(access);
      const ingest = await app.db.query.ingests.findFirst({
        where: eq(ingests.id, request.body.ingestId),
      });
      if (ingest?.streamId !== access.stream.id) {
        throw AppError.notFound('ingest not found on this stream');
      }
      return app.engine.setActiveIngest(toStream(access.stream).id, request.body.ingestId);
    },
  );

  r.get(
    '/streams/:id/runtime',
    { ...auth, schema: { params: StreamIdParams, response: { 200: StreamRuntime } } },
    async (request) => {
      const access = await loadStreamForUser(app.db, request.params.id, request.user);
      return app.engine.getRuntime(toStream(access.stream).id);
    },
  );

  // SSE proxy: stream the engine's event stream straight through to the browser.
  r.get('/streams/:id/events', auth, async (request, reply) => {
    const params = StreamIdParams.parse(request.params);
    const access = await loadStreamForUser(app.db, params.id, request.user);
    const upstream = await app.engine.openEventStream(toStream(access.stream).id);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const body: ReadableStream<Uint8Array> | null = upstream.body;
    if (!body) {
      reply.raw.end();
      return reply;
    }
    const reader = body.getReader();
    request.raw.on('close', () => {
      void reader.cancel();
    });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        reply.raw.write(chunk.value);
      }
    } catch {
      // Client disconnected or upstream ended; fall through to close.
    } finally {
      reply.raw.end();
    }
    return reply;
  });
}

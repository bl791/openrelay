import {
  IngestStatus,
  MediaServerAuthRequest,
  SetActiveIngestRequest,
  StartStreamRequest,
  StopStreamRequest,
  SwitchSceneRequest,
} from '@openrelay/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { IngestMonitor } from './ingest-monitor.js';
import type { SessionManager } from './session-manager.js';

export interface RouteDeps {
  readonly config: Config;
  readonly sessions: SessionManager;
  readonly ingest: IngestMonitor;
}

const StreamIdParams = z.object({ streamId: z.string().min(1) });
const IngestIdParams = z.object({ ingestId: z.string().min(1) });

const IngestSignalBody = z.object({
  streamId: z.string().min(1),
  bitrateKbps: z.number().nonnegative().optional(),
});

const HeartbeatBody = IngestSignalBody;

/**
 * Parse `body`/`params` with a zod schema, replying 400 on failure. Returns the
 * parsed value, or `undefined` when a 400 was already sent (caller must return).
 */
function parse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  reply: FastifyReply,
): T | undefined {
  const result = schema.safeParse(value);
  if (!result.success) {
    void reply.code(400).send({ error: 'ValidationError', issues: result.error.issues });
    return undefined;
  }
  return result.data;
}

/** Bearer-token auth preHandler guarding every non-public route. */
function requireToken(config: Config) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    const expected = `Bearer ${config.token}`;
    if (header !== expected) {
      await reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, sessions, ingest } = deps;
  const auth = requireToken(config);

  app.get('/healthz', (_request, reply) => {
    void reply.send({ status: 'ok', streams: sessions.list().length });
  });

  // MediaMTX's HTTP auth hook cannot attach a custom bearer header, so the
  // publish-authorization endpoint is intentionally outside the bearer-guarded
  // scope. It is safe: it only ever *admits* a publish whose path matches a live
  // ingest key (and is reachable on the internal network only). The ready/notready
  // hooks, which we drive via our own curl commands, remain token-guarded.
  app.post('/mediamtx/auth', async (request, reply) => {
    const body = parse(MediaServerAuthRequest, request.body, reply);
    if (body === undefined) {
      return reply;
    }
    if (body.action !== 'publish') {
      return reply.code(200).send({ ok: true });
    }
    const resolved = sessions.resolveIngestKey(pathToStreamKey(body.path));
    if (resolved === null) {
      return reply.code(401).send({ error: 'UnknownIngestKey' });
    }
    return reply.code(200).send({ ok: true, ...resolved });
  });

  app.register(
    (instance, _opts, done) => {
      instance.addHook('preHandler', auth);

      instance.post('/streams/start', async (request, reply) => {
        const body = parse(StartStreamRequest, request.body, reply);
        if (body === undefined) {
          return reply;
        }
        if (sessions.has(body.spec.streamId)) {
          return reply.conflict(`stream ${body.spec.streamId} is already running`);
        }
        const runtime = await sessions.start(body.spec);
        return reply.code(201).send(runtime);
      });

      instance.post('/streams/stop', async (request, reply) => {
        const body = parse(StopStreamRequest, request.body, reply);
        if (body === undefined) {
          return reply;
        }
        if (!sessions.has(body.streamId)) {
          return reply.notFound(`stream ${body.streamId} is not running`);
        }
        await sessions.stop(body.streamId);
        return reply.send({ stopped: body.streamId });
      });

      instance.post('/streams/scene', async (request, reply) => {
        const body = parse(SwitchSceneRequest, request.body, reply);
        if (body === undefined) {
          return reply;
        }
        if (!sessions.has(body.streamId)) {
          return reply.notFound(`stream ${body.streamId} is not running`);
        }
        const runtime = await sessions.switchScene(body.streamId, body.sceneId);
        return reply.send(runtime);
      });

      instance.post('/streams/ingest', async (request, reply) => {
        const body = parse(SetActiveIngestRequest, request.body, reply);
        if (body === undefined) {
          return reply;
        }
        if (!sessions.has(body.streamId)) {
          return reply.notFound(`stream ${body.streamId} is not running`);
        }
        const runtime = await sessions.setActiveIngest(body.streamId, body.ingestId);
        return reply.send(runtime);
      });

      instance.get('/streams/:streamId/runtime', (request, reply) => {
        const params = parse(StreamIdParams, request.params, reply);
        if (params === undefined) {
          return reply;
        }
        if (!sessions.has(params.streamId)) {
          return reply.notFound(`stream ${params.streamId} is not running`);
        }
        return reply.send(sessions.runtime(params.streamId));
      });

      instance.get('/streams/:streamId/events', (request, reply) => {
        const params = parse(StreamIdParams, request.params, reply);
        if (params === undefined) {
          return reply;
        }
        if (!sessions.has(params.streamId)) {
          return reply.notFound(`stream ${params.streamId} is not running`);
        }
        sendEventStream(instance, request, reply, sessions, params.streamId);
        return reply;
      });

      registerInternalRoutes(instance, sessions, ingest);
      registerMediaServerRoutes(instance, sessions, ingest);

      done();
    },
    { prefix: '' },
  );
}

function registerInternalRoutes(
  instance: FastifyInstance,
  sessions: SessionManager,
  ingest: IngestMonitor,
): void {
  instance.post('/internal/ingest/:ingestId/connect', async (request, reply) => {
    const params = parse(IngestIdParams, request.params, reply);
    const body = parse(IngestSignalBody, request.body, reply);
    if (params === undefined || body === undefined) {
      return reply;
    }
    await ingest.connect(body.streamId, params.ingestId, body.bitrateKbps);
    return reply.send({ ok: true });
  });

  instance.post('/internal/ingest/:ingestId/disconnect', async (request, reply) => {
    const params = parse(IngestIdParams, request.params, reply);
    const body = parse(IngestSignalBody, request.body, reply);
    if (params === undefined || body === undefined) {
      return reply;
    }
    await ingest.disconnect(body.streamId, params.ingestId);
    return reply.send({ ok: true });
  });

  instance.post('/internal/ingest/:ingestId/heartbeat', async (request, reply) => {
    const params = parse(IngestIdParams, request.params, reply);
    const body = parse(HeartbeatBody, request.body, reply);
    if (params === undefined || body === undefined) {
      return reply;
    }
    await ingest.heartbeat(body.streamId, params.ingestId, body.bitrateKbps);
    return reply.send({ ok: true });
  });

  // Exposed for completeness so an operator can directly push a status for tests.
  const ManualStatusBody = z.object({
    streamId: z.string().min(1),
    status: IngestStatus,
    bitrateKbps: z.number().nonnegative().optional(),
  });
  instance.post('/internal/ingest/:ingestId/status', async (request, reply) => {
    const params = parse(IngestIdParams, request.params, reply);
    const body = parse(ManualStatusBody, request.body, reply);
    if (params === undefined || body === undefined) {
      return reply;
    }
    if (!sessions.has(body.streamId)) {
      return reply.notFound(`stream ${body.streamId} is not running`);
    }
    await sessions.reportIngestStatus(
      body.streamId,
      params.ingestId,
      body.status,
      body.bitrateKbps,
    );
    return reply.send({ ok: true });
  });
}

/** Strip a leading `live/` (or any) prefix MediaMTX may include, leaving the key. */
function pathToStreamKey(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Token-guarded routes driven by MediaMTX's `runOnReady` / `runOnNotReady` hooks
 * (which we issue as our own curl commands, so they can carry the engine bearer
 * token). They mark the ingest matching the publish path live/offline, arming the
 * failover state machine. The unauthenticated publish-authorization endpoint lives
 * in {@link registerRoutes} because MediaMTX's auth hook cannot send a bearer.
 */
function registerMediaServerRoutes(
  instance: FastifyInstance,
  sessions: SessionManager,
  ingest: IngestMonitor,
): void {
  const PathBody = z.object({ path: z.string().min(1) });

  instance.post('/mediamtx/ready', async (request, reply) => {
    const body = parse(PathBody, request.body, reply);
    if (body === undefined) {
      return reply;
    }
    const resolved = sessions.resolveIngestKey(pathToStreamKey(body.path));
    if (resolved === null) {
      return reply.notFound('no live ingest for path');
    }
    await ingest.connect(resolved.streamId, resolved.ingestId);
    return reply.send({ ok: true, ...resolved });
  });

  instance.post('/mediamtx/notready', async (request, reply) => {
    const body = parse(PathBody, request.body, reply);
    if (body === undefined) {
      return reply;
    }
    const resolved = sessions.resolveIngestKey(pathToStreamKey(body.path));
    if (resolved === null) {
      return reply.send({ ok: true });
    }
    await ingest.disconnect(resolved.streamId, resolved.ingestId);
    return reply.send({ ok: true, ...resolved });
  });
}

/**
 * Stream {@link EngineEvent}s to the client as Server-Sent Events. The connection
 * stays open until the client disconnects; the manager subscription is cleaned up
 * on close.
 */
function sendEventStream(
  instance: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: SessionManager,
  streamId: string,
): void {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  // Prime with the current runtime so a late subscriber is immediately consistent.
  reply.raw.write(
    `data: ${JSON.stringify({ type: 'runtime', runtime: sessions.runtime(streamId) })}\n\n`,
  );

  const unsubscribe = sessions.subscribe(streamId, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  const keepalive = setInterval(() => {
    reply.raw.write(': keepalive\n\n');
  }, 15_000);
  keepalive.unref();

  const cleanup = (): void => {
    clearInterval(keepalive);
    unsubscribe();
  };
  request.raw.on('close', cleanup);
  instance.addHook('onClose', (_instance, done) => {
    cleanup();
    reply.raw.end();
    done();
  });
}

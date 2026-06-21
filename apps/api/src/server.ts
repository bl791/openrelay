import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import type { Database } from '@openrelay/db';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { EngineClient } from './engine-client.js';
import { AppError } from './errors.js';
import type { Logger } from './logger.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerClipRoutes } from './routes/clips.js';
import { registerDestinationRoutes } from './routes/destinations.js';
import { registerFriendRoutes } from './routes/friends.js';
import { registerIngestRoutes } from './routes/ingests.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerQuickstartRoutes } from './routes/quickstart.js';
import { registerSceneRoutes } from './routes/scenes.js';
import { registerStreamRoutes } from './routes/streams.js';
import { createMediaStorage, type MediaStorage } from './s3.js';

export interface BuildAppOptions {
  config: Config;
  logger: Logger;
  /** Inject a pre-built database (test seam); otherwise one is created on boot. */
  database?: Database;
  /** Inject an engine client (test seam); otherwise a real HTTP client is used. */
  engine?: EngineClient;
  /** Inject a media-storage client (test seam); otherwise an S3/MinIO one is built. */
  storage?: MediaStorage;
}

/**
 * Build the fully-wired Fastify app: security middleware, plugins, routes and the
 * central error handler. Does not listen — call {@link FastifyInstance.listen}.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, logger } = options;
  const logger_: FastifyBaseLogger = logger;
  const app = Fastify({ loggerInstance: logger_ }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(helmet, { crossOriginResourcePolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  // Clip/BRB uploads are proxied through the API (browser -> API -> object store),
  // so the browser only ever talks to this origin. 512 MiB cap per upload.
  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

  app.decorate('config', config);
  app.decorate(
    'engine',
    options.engine ?? new EngineClient({ baseUrl: config.engineUrl, token: config.engineToken }),
  );
  app.decorate('s3', options.storage ?? createMediaStorage(config));

  await app.register(dbPlugin, {
    databaseUrl: config.databaseUrl,
    ...(options.database ? { database: options.database } : {}),
  });
  await app.register(authPlugin, {
    jwtSecret: config.jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn,
  });

  setErrorHandler(app);

  app.get('/healthz', () => ({ status: 'ok' }));

  // Engine→API status reconciliation callback, authenticated with the shared
  // engine token rather than a user JWT. Registered outside the `/api` prefix.
  registerInternalRoutes(app);

  await app.register(
    (instance, _opts, done) => {
      registerAuthRoutes(instance);
      registerStreamRoutes(instance);
      registerQuickstartRoutes(instance);
      registerIngestRoutes(instance);
      registerDestinationRoutes(instance);
      registerSceneRoutes(instance);
      registerClipRoutes(instance);
      registerFriendRoutes(instance);
      done();
    },
    { prefix: '/api' },
  );

  return app;
}

/**
 * Map zod validation failures and {@link AppError}s to the core `ApiError`
 * envelope, and anything else to a generic 500 without leaking internals.
 */
function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      void reply.code(error.statusCode).send(error.toBody());
      return;
    }
    const cause: unknown =
      error !== null && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: unknown }).cause
        : undefined;
    if (error instanceof ZodError || cause instanceof ZodError) {
      const zerr = error instanceof ZodError ? error : (cause as ZodError);
      void reply.code(400).send({
        error: { code: 'validation_error', message: 'invalid request', details: zerr.issues },
      });
      return;
    }
    const statusCode =
      error !== null && typeof error === 'object' && 'statusCode' in error
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    const message = error instanceof Error ? error.message : 'unauthorized';
    if (statusCode === 401) {
      void reply.code(401).send({ error: { code: 'unauthorized', message } });
      return;
    }
    request.log.error({ err: error }, 'unhandled error');
    void reply
      .code(500)
      .send({ error: { code: 'internal_error', message: 'internal server error' } });
  });
}

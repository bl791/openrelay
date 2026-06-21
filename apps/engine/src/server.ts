import sensible from '@fastify/sensible';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { createDriverFactory } from './driver/index.js';
import { IngestMonitor } from './ingest-monitor.js';
import type { Logger } from './logger.js';
import { registerRoutes } from './routes.js';
import { SessionManager } from './session-manager.js';
import { StatusReporter } from './status-reporter.js';

export interface Engine {
  readonly app: FastifyInstance;
  readonly sessions: SessionManager;
  readonly ingest: IngestMonitor;
  readonly status: StatusReporter;
}

/**
 * Wire up the full engine: driver factory, session manager, ingest monitor and
 * the Fastify control server. Does not listen — call {@link FastifyInstance.listen}
 * (or use {@link startEngine}).
 */
export async function buildEngine(config: Config, logger: Logger): Promise<Engine> {
  // Annotate as the default-generic FastifyInstance so route registration (which
  // is written against the default logger generic) type-checks. A Pino logger is
  // a structural superset of Fastify's FastifyBaseLogger.
  const logger_: FastifyBaseLogger = logger;
  const app: FastifyInstance = Fastify({
    loggerInstance: logger_,
    disableRequestLogging: false,
  });
  await app.register(sensible);

  const driverFactory = createDriverFactory(config, logger);
  const sessions = new SessionManager(config, driverFactory, logger);
  const ingest = new IngestMonitor({ sessions, logger });
  ingest.start();

  const status = new StatusReporter({
    apiCallbackUrl: config.apiCallbackUrl,
    token: config.token,
    logger,
  });
  const unsubscribeStatus = sessions.onAnyEvent((event) => {
    status.report(event);
  });
  if (status.enabled) {
    logger.info({ url: config.apiCallbackUrl }, 'status reconciliation callbacks enabled');
  }

  registerRoutes(app, { config, sessions, ingest });

  app.addHook('onClose', async () => {
    unsubscribeStatus();
    ingest.stop();
    await sessions.stopAll();
  });

  return { app, sessions, ingest, status };
}

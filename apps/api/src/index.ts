import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildApp } from './server.js';

/**
 * API entrypoint: validate config, build the app, listen, and install graceful
 * shutdown so SIGTERM/SIGINT closes the HTTP server and DB pool cleanly.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const app = await buildApp({ config, logger });

  await app.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'openrelay api listening');

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    app
      .close()
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  console.error('fatal: failed to start api', error);
  process.exit(1);
});

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { buildEngine } from './server.js';

/**
 * Engine entrypoint: validate config, build the server, listen, and install
 * graceful shutdown so SIGTERM/SIGINT tears down every FFmpeg process cleanly.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const engine = await buildEngine(config, logger);

  await engine.app.listen({ port: config.port, host: config.host });
  logger.info(
    { port: config.port, host: config.host, simulate: config.simulate },
    'openrelay engine listening',
  );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    engine.app
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
  // Logger may not exist yet if config failed; fall back to console.
  console.error('fatal: failed to start engine', error);
  process.exit(1);
});

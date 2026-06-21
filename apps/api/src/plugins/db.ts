import { closeDatabase, createDatabase, type Database } from '@openrelay/db';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DbPluginOptions {
  databaseUrl: string;
  /**
   * Pre-built database to use instead of connecting. When provided the plugin
   * does not open or close the connection — the caller owns its lifetime. This
   * is the test seam used to inject a fake `Database`.
   */
  database?: Database;
}

/**
 * Decorate the app with `db`. On boot it creates a Postgres-backed
 * {@link Database} (unless one is injected) and closes it on shutdown.
 */
function dbPlugin(
  app: FastifyInstance,
  options: DbPluginOptions,
  done: (err?: Error) => void,
): void {
  if (options.database) {
    app.decorate('db', options.database);
    done();
    return;
  }

  const db = createDatabase({ url: options.databaseUrl });
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await closeDatabase(db);
  });
  done();
}

export default fp(dbPlugin, { name: 'openrelay-db' });

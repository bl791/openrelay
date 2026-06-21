import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { closeDatabase, createDatabase } from './client.js';

/** Standalone migration runner: `pnpm --filter @openrelay/db db:migrate`. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '../drizzle');

  const db = createDatabase({ url, max: 1 });
  try {
    await migrate(db, { migrationsFolder });
    console.log('✅ Migrations applied');
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error: unknown) => {
  console.error('❌ Migration failed:', error);
  process.exitCode = 1;
});

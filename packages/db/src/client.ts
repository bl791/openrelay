import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseOptions {
  /** Postgres connection string. */
  url: string;
  /** Maximum pool size. */
  max?: number;
}

/**
 * Create a Drizzle client bound to the OpenRelay schema. Callers own the lifetime
 * of the returned client and should invoke {@link closeDatabase} on shutdown.
 */
export function createDatabase({ url, max = 10 }: DatabaseOptions) {
  const sql = postgres(url, { max });
  const db = drizzle(sql, { schema });
  return Object.assign(db, { $client: sql });
}

export async function closeDatabase(db: Database): Promise<void> {
  await db.$client.end({ timeout: 5 });
}

import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured');
  }
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000 });
}

// Created on first query, not at import time: without DATABASE_URL (pure-local
// mode) importing this module must not throw. Callers catch query() rejections.
function getPool(): Pool {
  return (global.__pgPool ??= createPool());
}

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await getPool().query(text, params as never);
  return rows as T[];
}

/** The query surface a transaction callback receives (same shape as query()). */
export interface SqlExecutor {
  query<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Runs `fn` on one pooled connection inside BEGIN / COMMIT; any error rolls
 * back and is rethrown. Like query(), it rejects (catchable) without DATABASE_URL.
 */
export async function withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const tx: SqlExecutor = {
    async query<R = unknown>(text: string, params?: unknown[]) {
      const { rows } = await client.query(text, params as never);
      return rows as R[];
    },
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

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

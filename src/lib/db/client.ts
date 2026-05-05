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
  return new Pool({ connectionString, max: 10 });
}

export const pool: Pool = global.__pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  global.__pgPool = pool;
}

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const { rows } = await pool.query(text, params as never);
  return rows as T[];
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolOptions: [] as Record<string, unknown>[],
  poolQuery: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class {
    constructor(opts: Record<string, unknown>) {
      mocks.poolOptions.push(opts);
    }
    query = mocks.poolQuery;
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.poolOptions.length = 0;
  mocks.poolQuery.mockReset().mockResolvedValue({ rows: [{ ok: 1 }] });
  delete (globalThis as { __pgPool?: unknown }).__pgPool;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('db/client without DATABASE_URL (pure-local mode)', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', '');
  });

  it('can be imported without throwing', async () => {
    await expect(import('./client')).resolves.toBeDefined();
    expect(mocks.poolOptions).toHaveLength(0);
  });

  it('query() rejects with a catchable error instead of crashing at import time', async () => {
    const { query } = await import('./client');
    await expect(query('select 1')).rejects.toThrow('DATABASE_URL not configured');
  });

  it('projects.ts callers can degrade via try/catch', async () => {
    const { findProjectBySlug } = await import('./projects');
    const result = await findProjectBySlug('demo').catch(() => null);
    expect(result).toBeNull();
  });
});

describe('db/client with DATABASE_URL', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@localhost:5432/db');
  });

  it('creates the pool lazily on the first query, with a connection timeout', async () => {
    const { query } = await import('./client');
    expect(mocks.poolOptions).toHaveLength(0);

    await expect(query('select 1')).resolves.toEqual([{ ok: 1 }]);
    expect(mocks.poolOptions).toHaveLength(1);
    expect(mocks.poolOptions[0]).toMatchObject({
      connectionString: 'postgres://u:p@localhost:5432/db',
      connectionTimeoutMillis: 3000,
    });
  });

  it('reuses the same pool across queries', async () => {
    const { query } = await import('./client');
    await query('select 1');
    await query('select 2', [1]);
    expect(mocks.poolOptions).toHaveLength(1);
    expect(mocks.poolQuery).toHaveBeenCalledWith('select 2', [1]);
  });
});

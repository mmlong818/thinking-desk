import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from './client';
import { DELETE_SQL, deleteProject } from './delete-project';

// deleteProject() against a fake transaction, and DELETE /api/projects/[id] end to end with the
// pool's transaction mocked: no database.

const PID = '00000000-0000-0000-0000-00000000a001';

const tx = vi.hoisted(() => ({ current: null as null | (<T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>) }));
vi.mock('./client', () => ({
  withTransaction: <T,>(fn: (t: SqlExecutor) => Promise<T>) => {
    if (!tx.current) throw new Error('DATABASE_URL not configured');
    return tx.current(fn);
  },
}));

function fakeTx(opts: { exists?: boolean; failOn?: string } = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  let committed = false;
  const query: SqlExecutor['query'] = async <T,>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text === opts.failOn) throw new Error('connection reset');
    if (text === DELETE_SQL.lockProject) return ((opts.exists ?? true) ? [{ id: PID }] : []) as T[];
    if (text === DELETE_SQL.deleteProject) return [] as T[];
    return [{ n: calls.length }] as T[];
  };
  const withTransaction = async <T,>(fn: (t: SqlExecutor) => Promise<T>) => {
    const result = await fn({ query });
    committed = true;
    return result;
  };
  return { calls, withTransaction, committed: () => committed };
}

afterEach(() => {
  tx.current = null;
});

describe('deleteProject', () => {
  it('locks the project, then deletes events → links → items → runs → project in one transaction', async () => {
    const db = fakeTx();
    const deleted = await deleteProject(PID, db.withTransaction);
    expect(db.calls.map((c) => c.text)).toEqual([
      DELETE_SQL.lockProject, DELETE_SQL.deleteEvents, DELETE_SQL.deleteLinks,
      DELETE_SQL.deleteItems, DELETE_SQL.deleteRuns, DELETE_SQL.deleteProject,
    ]);
    expect(db.calls.every((c) => c.params[0] === PID && c.params.length === 1)).toBe(true);
    expect(deleted).toEqual({ events: 2, links: 3, items: 4, runs: 5 });
    expect(db.committed()).toBe(true);
  });

  it('is not_found for a missing project (nothing deleted) and for a non-UUID id (no query)', async () => {
    const db = fakeTx({ exists: false });
    await expect(deleteProject(PID, db.withTransaction)).rejects.toMatchObject({ code: 'not_found' });
    expect(db.calls.map((c) => c.text)).toEqual([DELETE_SQL.lockProject]);
    const none = fakeTx();
    await expect(deleteProject('demo-slug', none.withTransaction)).rejects.toMatchObject({ code: 'not_found' });
    expect(none.calls).toEqual([]);
  });

  it('propagates a failure mid-way so the transaction rolls back', async () => {
    const db = fakeTx({ failOn: DELETE_SQL.deleteItems });
    await expect(deleteProject(PID, db.withTransaction)).rejects.toThrow('connection reset');
    expect(db.committed()).toBe(false);
    expect(db.calls.map((c) => c.text)).not.toContain(DELETE_SQL.deleteProject);
  });
});

describe('DELETE /api/projects/[id]', () => {
  const call = async (id: string) => {
    const { DELETE } = await import('@/app/api/projects/[id]/route');
    const res = await DELETE(new Request(`http://localhost/api/projects/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('answers { ok, deleted } with the per-table counts', async () => {
    tx.current = fakeTx().withTransaction;
    expect(await call(PID)).toEqual({ status: 200, body: { ok: true, deleted: { events: 2, links: 3, items: 4, runs: 5 } } });
  });

  it('validates the id (400), maps a missing project to 404 and a database failure to 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await call('not-a-uuid')).toMatchObject({ status: 400, body: { error: 'invalid' } });
    tx.current = fakeTx({ exists: false }).withTransaction;
    expect(await call(PID)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    tx.current = null;
    expect(await call(PID)).toMatchObject({ status: 503, body: { error: 'db_unavailable' } });
  });
});

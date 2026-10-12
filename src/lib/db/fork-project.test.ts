import { describe, expect, it } from 'vitest';
import type { SqlExecutor } from './client';
import { forkProject, FORK_SQL } from './fork-project';

const FROM = '00000000-0000-0000-0000-00000000a001';
const TO = '00000000-0000-0000-0000-00000000b002';

function fakeTx(projectExists = true) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query: SqlExecutor['query'] = async <T,>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text === FORK_SQL.insertProject) return (projectExists ? [{ id: TO, slug: 'b-1234', name: params[1] }] : []) as T[];
    return [] as T[];
  };
  let transactions = 0;
  const withTransaction = async <T,>(fn: (tx: SqlExecutor) => Promise<T>) => {
    transactions += 1;
    return fn({ query });
  };
  return { calls, withTransaction, transactions: () => transactions };
}

describe('forkProject', () => {
  it('creates the project then copies runs → items → links → events in one transaction', async () => {
    const db = fakeTx();
    const project = await forkProject(FROM, { name: '分支' }, db.withTransaction);
    expect(project).toMatchObject({ id: TO });
    expect(db.transactions()).toBe(1);
    expect(db.calls.map((c) => c.text)).toEqual([
      FORK_SQL.insertProject, FORK_SQL.copyRuns, FORK_SQL.copyItems, FORK_SQL.copyLinks, FORK_SQL.copyEvents,
    ]);
    expect(db.calls[0].params.slice(0, 2)).toEqual([FROM, '分支']);
    expect(db.calls.slice(1).every((c) => c.params[0] === FROM && c.params[1] === TO)).toBe(true);
  });

  it('is not_found for a non-UUID or missing source project', async () => {
    await expect(forkProject('demo', { name: 'x' }, fakeTx().withTransaction)).rejects.toMatchObject({ code: 'not_found' });
    const db = fakeTx(false);
    await expect(forkProject(FROM, { name: 'x' }, db.withTransaction)).rejects.toMatchObject({ code: 'not_found' });
    expect(db.calls).toHaveLength(1);
  });
});

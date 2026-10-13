import { describe, expect, it, vi } from 'vitest';
import type { SqlExecutor } from './client';
import { PgRepository, SQL } from './pg-repository';
import type { ItemRow, LinkRow } from './pg-rows';
import { LocalRepository } from '../model/local-repository';
import type { Item } from '../model/item-types';
import {
  briefBody, makeItem, output, personaBody, rawJob, rawPersona, runInput, seqIdSource, T1,
} from '../model/__fixtures__/model';
import { memoryStorage } from '../model/__fixtures__/storage';

// SQL-level unit tests against a recording fake executor (no database). The
// statements themselves run against a real Postgres in pg-repository.int.test.ts.

const PID = '00000000-0000-0000-0000-00000000a001';

function asRow(i: Item): ItemRow {
  return {
    project_id: PID, id: i.id, node: i.node, type: i.type, body: i.body, origin: i.origin, decision: i.decision,
    decision_note: i.decisionNote ?? null, ai_stance: i.aiStance ?? null, evidence: i.evidence ?? null,
    version: i.version, run_id: i.runId ?? null, created_at: i.createdAt, updated_at: i.updatedAt,
    deleted_at: i.deletedAt ?? null,
  };
}

function fakeDb(seed: { items?: Item[]; links?: LinkRow[]; projectExists?: boolean } = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const itemRows = (seed.items ?? []).map(asRow);
  const query: SqlExecutor['query'] = async <T,>(text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text === SQL.lockProject) return (seed.projectExists === false ? [] : [{ id: params[0] }]) as T[];
    if (text === SQL.selectItems || text === SQL.selectLiveItems) return itemRows as T[];
    if (text === SQL.selectItem) return itemRows.filter((r) => r.id === params[1]) as T[];
    if (text === SQL.selectLinks) return (seed.links ?? []) as T[];
    return [] as T[];
  };
  let transactions = 0;
  const withTransaction = async <T,>(fn: (tx: SqlExecutor) => Promise<T>) => {
    transactions += 1;
    return fn({ query });
  };
  const repo = new PgRepository({ query, withTransaction, now: () => T1, idSource: seqIdSource() });
  const writes = () => calls.filter((c) => !c.text.startsWith('SELECT'));
  return { repo, calls, writes, transactions: () => transactions };
}

const usersRun = output({
  drafts: [
    { ref: 'p1', type: 'persona', body: rawPersona('p1') },
    { ref: 'j1', type: 'job', body: rawJob('j1', ['p1']) },
  ],
  replace: [{ node: 'users', type: 'persona' }],
});

const jsonParam = (p: unknown) => JSON.parse(String(p)) as Record<string, unknown>[];

describe('PgRepository.saveRunOutput', () => {
  it('locks the project, loads state and writes in FK-safe order inside one transaction', async () => {
    const db = fakeDb();
    await db.repo.saveRunOutput(PID, usersRun);
    expect(db.transactions()).toBe(1);
    expect(db.calls.map((c) => c.text)).toEqual([
      SQL.lockProject, SQL.selectItems, SQL.selectLinks, SQL.insertRun, SQL.insertItems, SQL.insertLinks, SQL.insertEvents,
    ]);
  });

  it('sends items as snake_case JSON with absent optionals omitted (→ SQL NULL)', async () => {
    const db = fakeDb();
    await db.repo.saveRunOutput(PID, usersRun);
    const items = jsonParam(db.calls.find((c) => c.text === SQL.insertItems)?.params[1]);
    expect(items[0]).toEqual({
      id: 'per_00000002', node: 'users', type: 'persona', body: personaBody(), origin: 'ai', decision: 'pending',
      version: 1, run_id: 'run_00000001', created_at: T1, updated_at: T1,
    });
    const run = db.calls.find((c) => c.text === SQL.insertRun)?.params ?? [];
    expect(run.slice(0, 4)).toEqual([PID, 'run_00000001', 'USERS_JTBD', 'users']);
    expect(run[7]).toBe('[]');
    expect(run[10]).toBeNull();
  });

  it('retires replaced items via the overwrite statement and deletes their links', async () => {
    const stale = makeItem({ id: 'per_old', projectId: PID });
    const job = makeItem({ id: 'job_old', projectId: PID, type: 'job', body: { title: 'J', reach: 1, impact: 1, source: 's', dimension: 'social' }, decision: 'accepted' });
    const link: LinkRow = { project_id: PID, id: 'lnk_old', from_id: 'job_old', to_id: 'per_old', rel: 'derived_from', to_version_seen: 1 };
    const db = fakeDb({ items: [stale, job], links: [link] });
    const res = await db.repo.saveRunOutput(PID, usersRun);
    expect(res.retired).toEqual(['per_old']);
    const overwritten = jsonParam(db.calls.find((c) => c.text === SQL.overwriteItems)?.params[1]);
    expect(overwritten).toMatchObject([{ id: 'per_old', deleted_at: T1 }]);
    expect(db.calls.find((c) => c.text === SQL.deleteLinks)?.params).toEqual([PID, ['lnk_old']]);
  });

  it('returns exactly what LocalRepository returns for the same input', async () => {
    const pg = await fakeDb().repo.saveRunOutput(PID, usersRun);
    const local = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
    expect(pg).toEqual(await local.saveRunOutput(PID, usersRun));
  });

  it('rejects unknown projects without writing', async () => {
    const missing = fakeDb({ projectExists: false });
    await expect(missing.repo.saveRunOutput(PID, usersRun)).rejects.toMatchObject({ code: 'not_found' });
    expect(missing.writes()).toEqual([]);
    const bad = fakeDb();
    await expect(bad.repo.saveRunOutput('my-slug', usersRun)).rejects.toMatchObject({ code: 'not_found' });
    expect(bad.calls).toEqual([]);
  });
});

describe('PgRepository · other methods', () => {
  const persona = makeItem({ id: 'per_1', projectId: PID });

  it('updateItem writes the item and its events, and skips no-ops', async () => {
    const db = fakeDb({ items: [persona] });
    const updated = await db.repo.updateItem(PID, 'per_1', { decision: 'accepted' }, { actor: 'human' });
    expect(updated.decision).toBe('accepted');
    expect(db.writes().map((c) => c.text)).toEqual([SQL.overwriteItems, SQL.insertEvents]);
    const noop = fakeDb({ items: [persona] });
    await noop.repo.updateItem(PID, 'per_1', { body: personaBody() }, { actor: 'human' });
    expect(noop.writes()).toEqual([]);
    await expect(noop.repo.updateItem(PID, 'nope', { decision: 'accepted' }, { actor: 'human' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('createItem inserts the item, its links and events', async () => {
    const db = fakeDb({ items: [persona] });
    await db.repo.createItem(PID, {
      node: 'users', type: 'job', body: { title: 'J', reach: 1, impact: 1, source: 's', dimension: 'social' },
      links: [{ to: 'per_1', rel: 'derived_from' }],
    });
    expect(db.writes().map((c) => c.text)).toEqual([SQL.insertItems, SQL.insertLinks, SQL.insertEvents]);
  });

  it('listItems builds a parameterised filter', async () => {
    const db = fakeDb({ items: [persona] });
    await db.repo.listItems(PID, { node: 'users', decision: 'pending' });
    expect(db.calls[0].text).toBe(
      'SELECT * FROM items WHERE project_id = $1 AND deleted_at IS NULL AND node = $2 AND decision = $3 ORDER BY seq',
    );
    expect(db.calls[0].params).toEqual([PID, 'users', 'pending']);
  });

  it('skips stored rows that fail validation and reports them', async () => {
    const onInvalidRows = vi.fn();
    const calls: string[] = [];
    const repo = new PgRepository({
      query: async <T,>(text: string) => {
        calls.push(text);
        return [{ ...asRow(persona), origin: 'robot' }, asRow(persona)] as T[];
      },
      onInvalidRows,
    });
    expect(await repo.listItems(PID)).toHaveLength(1);
    expect(onInvalidRows).toHaveBeenCalledWith('items', 1);
  });
});

describe('PgRepository · decision follow-ups', () => {
  it('records a run without valid output as failed: only the run row is written', async () => {
    const db = fakeDb({ items: [makeItem({ id: 'per_old', projectId: PID })] });
    const res = await db.repo.saveRunOutput(PID, output({
      drafts: [{ type: 'persona', body: { name: 1 } }], replace: [{ node: 'users', type: 'persona' }],
    }));
    expect(res.run.status).toBe('failed');
    expect(db.writes().map((c) => c.text)).toEqual([SQL.insertRun]);
    expect(db.writes()[0].params[8]).toBe('failed');
  });

  it('sends prevBody with the edited event of a rewritten singleton', async () => {
    const brief = makeItem({
      id: 'brf_1', projectId: PID, node: 'brief', type: 'brief', decision: 'accepted',
      body: { ...briefBody('v1'), highlights: [], follow_ups: [], completeness: 0, answers: [], follow_up_answers: {} },
    });
    const db = fakeDb({ items: [brief] });
    await db.repo.saveRunOutput(PID, output({
      run: runInput({ task: 'BRIEF_EXTRACT', node: 'brief' }), drafts: [{ type: 'brief', body: briefBody('v2') }],
    }));
    const events = jsonParam(db.calls.find((c) => c.text === SQL.insertEvents)?.params[1]);
    expect(events[0]).toMatchObject({ kind: 'edited', prevBody: brief.body });
    expect(SQL.insertEvents).toContain("e.v->'prevBody'");
  });

  it('acceptRecommended locks, then writes items and events in one transaction', async () => {
    const recommend = { verdict: 'recommend' as const, reason: 'r' };
    const db = fakeDb({ items: [makeItem({ id: 'per_1', projectId: PID, aiStance: recommend }), makeItem({ id: 'per_2', projectId: PID })] });
    const accepted = await db.repo.acceptRecommended(PID, 'users');
    expect(accepted.map((i) => i.id)).toEqual(['per_1']);
    expect(db.transactions()).toBe(1);
    expect(db.calls.map((c) => c.text)).toEqual([
      SQL.lockProject, SQL.selectItems, SQL.selectLinks, SQL.overwriteItems, SQL.insertEvents,
    ]);
    const none = fakeDb({ items: [makeItem({ id: 'per_2', projectId: PID })] });
    expect(await none.repo.acceptRecommended(PID, 'users')).toEqual([]);
    expect(none.writes()).toEqual([]);
  });
});

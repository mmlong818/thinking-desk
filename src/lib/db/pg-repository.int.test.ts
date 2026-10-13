import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../model/repository';
import { LocalRepository } from '../model/local-repository';
import { staleItems } from '../model/graph';
import {
  briefBody, jobBody, output, personaBody, rawJob, rawPersona, runInput, seqIdSource, T1,
} from '../model/__fixtures__/model';
import { memoryStorage } from '../model/__fixtures__/storage';

// Opt-in integration test: runs only when TEST_DATABASE_URL points at a
// throwaway Postgres (it applies schema.sql there). CI skips it.
//   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres pnpm vitest run src/lib/db
const url = process.env.TEST_DATABASE_URL;
const DEMO_OWNER = '00000000-0000-0000-0000-000000000001';

type Client = typeof import('./client');

/** The same sequence of writes, used to compare Pg with LocalRepository. */
async function scenario(repo: Repository, pid: string) {
  const first = await repo.saveRunOutput(pid, output({
    drafts: [
      { ref: 'p1', type: 'persona', body: rawPersona('p1', 'A') },
      { ref: 'p2', type: 'persona', body: rawPersona('p2', 'B') },
      { ref: 'j1', type: 'job', body: rawJob('j1', ['p1']) },
      { ref: 'j2', type: 'job', body: rawJob('j2', ['p1', 'p2']) },
      { type: 'critique', body: { kind: 'ask', title: 't', body: 'b' } },
    ],
    replace: [{ node: 'users', type: 'persona' }, { node: 'users', type: 'job' }, { node: 'users', type: 'critique' }],
  }));
  const id = (k: string) => first.idMap[k];
  await repo.updateItem(pid, id('persona:p1'), { decision: 'accepted', decisionNote: 'core' }, { actor: 'human' });
  await repo.updateItem(pid, id('persona:p2'), { decision: 'rejected', decisionNote: 'duplicate' }, { actor: 'human' });
  await repo.updateItem(pid, id('job:j1'), { body: jobBody('edited') }, { actor: 'human' });
  await repo.createItem(pid, { node: 'users', type: 'job', body: jobBody('mine'), links: [{ to: id('persona:p1'), rel: 'derived_from' }] });
  await repo.saveRunOutput(pid, output({
    run: runInput({ inputs: [{ itemId: id('persona:p1'), version: 1 }] }),
    drafts: [
      { ref: 'p3', type: 'persona', body: rawPersona('p3', 'C') },
      { ref: id('job:j2'), type: 'job', body: rawJob(id('job:j2'), [], 'J2 v2') },
      { ref: 'j9', type: 'job', body: rawJob('j9', [id('persona:p1'), 'p3']) },
    ],
    replace: [{ node: 'users', type: 'persona' }, { node: 'users', type: 'job' }],
  }));
  await repo.updateItem(pid, id('persona:p1'), { body: personaBody('A v2') }, { actor: 'human' });
  const stale = staleItems(await repo.getGraph(pid)).flatMap((s) => s.links.map((l) => l.id)).slice(0, 1);
  await repo.refreshLinks(pid, stale);
  await repo.updateItem(pid, id('job:j1'), { deleted: true }, { actor: 'human' });
  const briefRun = runInput({ task: 'BRIEF_EXTRACT', node: 'brief' });
  await repo.saveRunOutput(pid, output({ run: briefRun, drafts: [{ type: 'brief', body: briefBody('p', 'r') }] }));
  await repo.saveRunOutput(pid, output({ run: briefRun, drafts: [{ type: 'brief', body: briefBody('p', 'r2') }] }));
  await repo.saveRunOutput(pid, output({
    run: runInput({ task: 'STAKE_MATRIX', node: 'stake' }),
    drafts: [{ type: 'critique', node: 'stake', body: { kind: 'check', title: 'r', body: 'b' }, aiStance: { verdict: 'recommend', reason: 'r' } }],
  }));
  await repo.acceptRecommended(pid, 'stake');
  await repo.saveRunOutput(pid, output({ drafts: [{ type: 'persona', body: { name: 1 } }], replace: [{ node: 'users', type: 'persona' }] }));
  await repo.saveRunOutput(pid, output({ run: runInput({ status: 'failed', error: 'timeout' }) }));
}

async function snapshot(repo: Repository, pid: string) {
  return {
    graph: await repo.getGraph(pid),
    all: await repo.listItems(pid, { includeDeleted: true }),
    runs: await repo.listRuns(pid),
    events: await repo.listEvents(pid),
  };
}

describe.skipIf(!url)('PgRepository against Postgres', () => {
  let client: Client;
  let pid = '';

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', url ?? '');
    client = await import('./client');
    await client.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const [row] = await client.query<{ id: string }>(
      `INSERT INTO projects (owner_id, name, slug) VALUES ($1, 'it', 'it-' || gen_random_uuid()) RETURNING id`,
      [DEMO_OWNER],
    );
    pid = row.id;
  });

  afterAll(async () => {
    if (client) await client.query('DELETE FROM projects WHERE id = $1', [pid]).catch(() => undefined);
    await (globalThis as { __pgPool?: { end(): Promise<void> } }).__pgPool?.end();
    vi.unstubAllEnvs();
  });

  it('behaves exactly like LocalRepository for the same sequence of writes', async () => {
    const { PgRepository } = await import('./pg-repository');
    const pg = new PgRepository({ now: () => T1, idSource: seqIdSource() });
    const local = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
    await scenario(pg, pid);
    await scenario(local, pid);
    const [a, b] = [await snapshot(pg, pid), await snapshot(local, pid)];
    expect(a.graph).toEqual(b.graph);
    expect(a.all).toEqual(b.all);
    expect(a.runs).toEqual(b.runs);
    expect(a.events).toEqual(b.events);
    expect(a.all.length).toBeGreaterThan(5);
    expect(a.events.length).toBeGreaterThan(10);
    expect(a.events.some((e) => e.kind === 'edited' && e.prevBody !== undefined)).toBe(true);
    expect(a.runs.filter((r) => r.status === 'failed')).toHaveLength(2);
  });

  it('serialises concurrent runs on one project (row lock) without id clashes', async () => {
    const { PgRepository } = await import('./pg-repository');
    const repo = new PgRepository();
    const results = await Promise.all([1, 2, 3].map((n) =>
      repo.saveRunOutput(pid, output({ run: runInput({ node: 'stake', task: 'STAKE_MATRIX' }), drafts: [
        { type: 'critique', node: 'stake', body: { kind: 'check', title: `c${n}`, body: 'b' } },
      ] })),
    ));
    expect(new Set(results.map((r) => r.created[0].id)).size).toBe(3);
  });

  it('enforces one live singleton per node at the database level too', async () => {
    const insert = `INSERT INTO items (project_id, id, node, type, body, origin) VALUES ($1, $2, 'stake', 'engagement_plan', '{}'::jsonb, 'ai')`;
    await client.query(insert, [pid, 'eng_a']);
    await expect(client.query(insert, [pid, 'eng_b'])).rejects.toThrow(/items_singleton_idx/);
  });

  it('rolls back the whole run when a statement fails', async () => {
    const { PgRepository } = await import('./pg-repository');
    const before = await client.query<{ n: string }>('SELECT count(*) AS n FROM runs WHERE project_id = $1', [pid]);
    const failing = new PgRepository({
      withTransaction: (fn) => client.withTransaction(async (tx) => fn({
        query: async <T,>(text: string, params?: unknown[]) => {
          if (text.startsWith('INSERT INTO decision_events')) throw new Error('injected');
          return tx.query<T>(text, params);
        },
      })),
    });
    await expect(failing.saveRunOutput(pid, output({ drafts: [{ ref: 'x', type: 'persona', body: rawPersona('x') }] })))
      .rejects.toThrow('injected');
    const after = await client.query<{ n: string }>('SELECT count(*) AS n FROM runs WHERE project_id = $1', [pid]);
    expect(after[0].n).toBe(before[0].n);
  });

  it('lists projects from items', async () => {
    const { listProjects } = await import('./projects');
    const p = (await listProjects(DEMO_OWNER)).find((x) => x.id === pid);
    expect(p?.node_count).toBe(3);
    expect(['users', 'brief', 'stake']).toContain(p?.last_node_kind);
  });

  it('forks a project with every run, item, link and event', async () => {
    const { forkProject } = await import('./fork-project');
    const { PgRepository } = await import('./pg-repository');
    const repo = new PgRepository();
    const fork = await forkProject(pid, { name: 'it fork' });
    try {
      const [a, b] = [await snapshot(repo, pid), await snapshot(repo, fork.id)];
      const strip = <T extends { projectId: string }>(xs: T[]) => xs.map(({ projectId: _p, ...rest }) => rest);
      expect(strip(b.all)).toEqual(strip(a.all));
      expect(strip(b.graph.links)).toEqual(strip(a.graph.links));
      expect(strip(b.runs)).toEqual(strip(a.runs));
      expect(strip(b.events)).toEqual(strip(a.events));
    } finally {
      await client.query('DELETE FROM projects WHERE id = $1', [fork.id]);
    }
  });

  it('deletes a project with all its rows in one transaction; a second delete is not_found', async () => {
    const { forkProject } = await import('./fork-project');
    const { deleteProject } = await import('./delete-project');
    const doomed = await forkProject(pid, { name: 'it delete' });
    const rows = async () => Promise.all(['runs', 'items', 'links', 'decision_events'].map(async (t) =>
      (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [doomed.id]))[0].n));
    const [runs, items, links, events] = await rows();
    expect(await deleteProject(doomed.id)).toEqual({ runs, items, links, events });
    expect(items).toBeGreaterThan(0);
    expect(await rows()).toEqual([0, 0, 0, 0]);
    expect(await client.query('SELECT 1 FROM projects WHERE id = $1', [doomed.id])).toEqual([]);
    await expect(deleteProject(doomed.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await snapshot(new (await import('./pg-repository')).PgRepository(), pid)).all.length).toBeGreaterThan(5);
  });
});
